import Groq from "groq-sdk";
import type { Business, Customer } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { buildSystemPrompt } from "./prompt";
import { executeTool, toolDefs } from "./tools";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

/** Máximo de vueltas del bucle de tools: corta alucinaciones en bucle y protege la cuota free. */
const MAX_VUELTAS = 5;

/** Lo que le decimos al paciente si Groq falla (rate limit, caída, timeout…). */
const FALLBACK =
  "Dame un momentico y te confirmo 🙏";

/**
 * Llama a veces escribe la llamada a la tool COMO TEXTO en vez de usar el campo
 * estructurado `tool_calls`. Visto en vivo contra Groq:
 *
 *   "¿…prefieres que guarde tu interés? <function=guardar_lead>{"interes":"…"}</function>"
 *
 * Sin esto, el paciente recibe esa basura por WhatsApp. No se puede confiar en que el
 * modelo respete siempre el formato: limpiamos su salida antes de que salga al mundo.
 */
const PATRONES_FUGA: RegExp[] = [
  /<function=[\s\S]*?<\/function>/gi, // <function=nombre>{...}</function>
  /<function=[^>]*>\s*\{[\s\S]*?\}\s*/gi, // igual pero sin cerrar la etiqueta
  /<tool_call>[\s\S]*?<\/tool_call>/gi, // <tool_call>{...}</tool_call>
  /<\|python_tag\|>[\s\S]*$/gi, // marcador de Llama
  /<\/?function[^>]*>/gi, // etiquetas sueltas que queden
];

export function limpiarRespuesta(texto: string): string {
  let limpio = texto;
  for (const patron of PATRONES_FUGA) limpio = limpio.replace(patron, " ");

  // Espacios que quedan tras quitar los bloques.
  return limpio.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

/**
 * Detecta salida DEGENERADA del modelo.
 *
 * Visto en vivo con `openai/gpt-oss-120b` (1 de cada 5 corridas): tras usar una tool,
 * devolvió "Cita c …......… ¡............ … …" — puntuación y espacios sin sentido.
 * Eso se le habría enviado a un paciente.
 *
 * Ningún modelo es infalible, así que en vez de elegir modelo por miedo, filtramos aquí:
 * si el texto es casi todo puntuación/espacios, preferimos el fallback amable.
 */
export function pareceBasura(texto: string): boolean {
  if (texto.length < 25) return false; // mensajes cortos legítimos ("Listo 👍")

  // Proporción de letras/números frente al total (emojis y signos no cuentan como letra).
  const letras = (texto.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (letras / texto.length < 0.5) return true;

  // Rachas largas de puntos o puntos suspensivos.
  return /[.…]{6,}/.test(texto);
}

export interface HistoryEntry {
  direction: string; // "in" | "out"
  content: string;
}

export interface RunAgentArgs {
  business: Business;
  customer: Customer;
  history: HistoryEntry[];
}

type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

/**
 * Une mensajes consecutivos del mismo rol en uno solo.
 * Algunos modelos (Llama entre ellos) se comportan mal con varios turnos seguidos
 * del mismo rol, y el debounce hace justo eso: agrupa varias ráfagas del paciente.
 */
function mergeConsecutive(messages: ChatMessage[]): ChatMessage[] {
  const salida: ChatMessage[] = [];

  for (const msg of messages) {
    const anterior = salida[salida.length - 1];
    const fusionable =
      anterior !== undefined &&
      anterior.role === msg.role &&
      (msg.role === "user" || msg.role === "assistant") &&
      typeof anterior.content === "string" &&
      typeof msg.content === "string";

    if (fusionable) {
      (anterior as { content: string }).content += `\n${msg.content as string}`;
    } else {
      salida.push(msg);
    }
  }

  return salida;
}

/**
 * Corre el agente y devuelve el texto para el paciente.
 * Contrato: NUNCA lanza. Ante cualquier error devuelve el fallback amable.
 */
export async function runAgent({ business, customer, history }: RunAgentArgs): Promise<string> {
  const messages: ChatMessage[] = mergeConsecutive([
    { role: "system", content: buildSystemPrompt(business) },
    ...history.map(
      (h): ChatMessage =>
        h.direction === "in"
          ? { role: "user", content: h.content }
          : { role: "assistant", content: h.content },
    ),
  ]);

  try {
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const respuesta = await groq.chat.completions.create({
        model: env.GROQ_MODEL,
        messages,
        tools: toolDefs,
        tool_choice: "auto",
        temperature: 0.6,
        max_tokens: 500,
      });

      const choice = respuesta.choices[0]?.message;
      if (!choice) return FALLBACK;

      const toolCalls = choice.tool_calls ?? [];

      // Sin tools pendientes: esto ya es la respuesta para el paciente.
      if (toolCalls.length === 0) {
        const crudo = (choice.content ?? "").trim();
        const texto = limpiarRespuesta(crudo);

        if (texto !== crudo) {
          logger.warn(
            { businessId: business.id },
            "El modelo escribió una llamada a tool como texto; se limpió antes de enviar",
          );
        }

        // Red de seguridad: jamás mandarle galimatías a un paciente.
        if (pareceBasura(texto)) {
          logger.warn(
            { businessId: business.id, muestra: texto.slice(0, 60) },
            "El modelo devolvió texto degenerado; se usa el fallback",
          );
          return FALLBACK;
        }

        return texto.length > 0 ? texto : FALLBACK;
      }

      // Hay tools: empujamos el turno del assistant tal cual y ejecutamos cada una.
      messages.push({
        role: "assistant",
        content: choice.content ?? "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const resultado = await executeTool(call.function.name, call.function.arguments, {
          business,
          customer,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: resultado });
      }
    }

    // Se acabaron las vueltas sin una respuesta de texto.
    logger.warn(
      { businessId: business.id },
      "El agente agotó las vueltas de tools sin responder texto",
    );
    return FALLBACK;
  } catch (err) {
    // Rate limit de Groq, caída, timeout… el paciente nunca ve un error técnico.
    logger.error({ businessId: business.id, err }, "Error llamando a Groq; se usa el fallback");
    return FALLBACK;
  }
}
