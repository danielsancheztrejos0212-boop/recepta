import type { Business } from "@prisma/client";
import { z } from "zod";

/**
 * Forma de `Business.systemPromptConfig` (todo opcional: el panel puede guardar
 * lo que el dueño quiera y el prompt se arma con defaults sensatos).
 */
const servicioSchema = z
  .object({
    nombre: z.string().optional(),
    precio: z.string().optional(),
    duracion: z.string().optional(),
  })
  .loose();

const configSchema = z
  .object({
    tipo: z.string().optional(),
    direccion: z.string().optional(),
    horario: z.string().optional(),
    personalidad: z.string().optional(),
    servicios: z.array(servicioSchema).optional(),
    preguntasCita: z.array(z.string()).optional(),
    infoAdicional: z.string().optional(),
  })
  .loose();

export type PromptConfig = z.infer<typeof configSchema>;

/** Lee la config del negocio sin lanzar nunca: si el JSON es basura, devuelve {}. */
export function parsePromptConfig(raw: unknown): PromptConfig {
  const parsed = configSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Fecha y hora actuales en la zona horaria del consultorio, en español. */
function ahoraEnZona(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());
  } catch {
    // Timezone inválida en la BD: no es motivo para tumbar la conversación.
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());
  }
}

/** Fecha de hoy en formato YYYY-MM-DD, en la zona del consultorio (para la tool agendar_cita). */
export function hoyISO(timezone: string): string {
  try {
    // en-CA da directamente YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  }
}

/**
 * Arma el system prompt del agente a partir de la configuración del consultorio.
 * Todo vive en la BD, no en el código: cada consultorio suena distinto sin tocar nada aquí.
 */
export function buildSystemPrompt(business: Business): string {
  const cfg = parsePromptConfig(business.systemPromptConfig);

  const tipo = cfg.tipo?.trim() || business.type || "consultorio de salud";
  const personalidad = cfg.personalidad?.trim() || "cálida, cercana y profesional";

  const partes: string[] = [];

  partes.push(
    `Eres la recepcionista virtual de "${business.name}", un(a) ${tipo}.`,
    `Tu personalidad es ${personalidad}. Escribes en español colombiano, natural y sin sonar robótica.`,
    "",
    `Fecha y hora actuales (zona ${business.timezone}): ${ahoraEnZona(business.timezone)}.`,
    `La fecha de hoy en formato YYYY-MM-DD es ${hoyISO(business.timezone)}. Úsala para interpretar "mañana", "el viernes", etc.`,
  );

  if (cfg.direccion?.trim()) partes.push(`Dirección del consultorio: ${cfg.direccion.trim()}.`);
  if (cfg.horario?.trim()) partes.push(`Horario de atención: ${cfg.horario.trim()}.`);

  const servicios = (cfg.servicios ?? []).filter((s) => s.nombre?.trim());
  if (servicios.length > 0) {
    partes.push("", "SERVICIOS (esta es toda la oferta; no existe nada fuera de esta lista):");
    for (const s of servicios) {
      const detalles = [
        s.precio?.trim() ? `precio: ${s.precio.trim()}` : null,
        s.duracion?.trim() ? `duración: ${s.duracion.trim()}` : null,
      ].filter(Boolean);
      partes.push(`  • ${s.nombre!.trim()}${detalles.length ? ` (${detalles.join(", ")})` : ""}`);
    }
  } else {
    partes.push(
      "",
      "SERVICIOS: todavía no hay servicios cargados. No inventes ninguno: si te preguntan por servicios o precios, dilo con honestidad y ofrece tomar los datos con la herramienta guardar_lead.",
    );
  }

  if (cfg.infoAdicional?.trim()) {
    partes.push("", `Información adicional útil: ${cfg.infoAdicional.trim()}`);
  }

  const preguntas = (cfg.preguntasCita ?? []).filter((p) => p.trim());
  const preguntasTexto =
    preguntas.length > 0
      ? preguntas.map((p) => `"${p.trim()}"`).join(", ")
      : '"nombre completo", "servicio deseado", "fecha y hora preferida"';

  partes.push(
    "",
    "REGLAS OBLIGATORIAS (no las rompas nunca):",
    "1. Nunca inventes servicios, precios, horarios ni promociones. Si algo no está en tu información, dilo con naturalidad y ofrece guardar el dato con la herramienta `guardar_lead` para que una persona del equipo responda.",
    "2. No des diagnósticos ni consejo médico, aunque insistan. Ofrece agendar una valoración con un profesional.",
    "3. No pidas datos sensibles: historia clínica, documentos de identidad, ni datos de pago o tarjetas.",
    "4. Si te preguntan si eres un bot o una IA, dilo con naturalidad y sin drama (eres un asistente virtual del consultorio).",
    "5. Mensajes cortos, estilo WhatsApp. Frases breves, sin listas largas ni formato markdown. Máximo un emoji ocasional.",
    `6. Antes de agendar reúne TODOS estos datos: ${preguntasTexto}. Cuando los tengas, llama a la herramienta \`agendar_cita\` UNA sola vez y luego confirma al paciente en un mensaje corto.`,
    "7. No repitas el saludo en cada mensaje: saluda solo al inicio de la conversación.",
  );

  return partes.join("\n");
}
