import type { Business } from "@prisma/client";
import { env } from "../config/env";
import { logger, maskPhone } from "../lib/logger";

function endpoint(business: Business): string {
  return `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${business.wabaPhoneNumberId}/messages`;
}

/**
 * Limpia el cuerpo de error de Meta antes de loguearlo.
 *
 * Meta ECHA EL TOKEN DE VUELTA en algunos errores (p. ej. "Malformed access token EAAG…"),
 * así que loguear su respuesta cruda filtra el secreto del consultorio. El `redact` de pino
 * no sirve aquí: trabaja sobre rutas de objetos, no sobre secretos incrustados en un string.
 * Detectado con una prueba real contra la Graph API, no en los tests unitarios.
 */
function sanitizarError(detalle: string, accessToken: string): string {
  let limpio = detalle;

  if (accessToken.length > 0) {
    limpio = limpio.split(accessToken).join("[TOKEN_REDACTADO]");
  }

  // Red de seguridad: cualquier otro token de Meta (empiezan por EAA) o de Groq (gsk_).
  limpio = limpio
    .replace(/EAA[A-Za-z0-9_-]{6,}/g, "[TOKEN_REDACTADO]")
    .replace(/gsk_[A-Za-z0-9_-]{6,}/g, "[TOKEN_REDACTADO]");

  // Los errores de Meta son cortos; si llega algo enorme, no llenamos el log.
  return limpio.length > 500 ? `${limpio.slice(0, 500)}…` : limpio;
}

/**
 * Envía un mensaje de texto al paciente.
 * Nunca relanza: un fallo de la Graph API no puede tumbar el webhook ni el proceso.
 * Devuelve true si Meta aceptó el mensaje.
 */
export async function sendText(business: Business, to: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(endpoint(business), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${business.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const crudo = await res.text().catch(() => "(sin cuerpo)");
      logger.error(
        {
          businessId: business.id,
          to: maskPhone(to),
          status: res.status,
          detalle: sanitizarError(crudo, business.accessToken),
        },
        "Meta rechazó el envío del mensaje",
      );
      return false;
    }

    logger.info({ businessId: business.id, to: maskPhone(to) }, "Mensaje enviado");
    return true;
  } catch (err) {
    logger.error(
      { businessId: business.id, to: maskPhone(to), err },
      "Error de red enviando mensaje a Meta",
    );
    return false;
  }
}

/**
 * Marca el mensaje como leído y muestra el indicador "escribiendo…" al paciente.
 * Es puramente cosmético (efecto humano): fire-and-forget, cualquier error se ignora.
 */
export async function markReadAndTyping(business: Business, waMessageId: string): Promise<void> {
  try {
    const res = await fetch(endpoint(business), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${business.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: waMessageId,
        typing_indicator: { type: "text" },
      }),
    });

    if (!res.ok) {
      // Nivel debug: que falle el "escribiendo…" no le importa a nadie.
      logger.debug(
        { businessId: business.id, status: res.status },
        "No se pudo marcar leído / mostrar typing",
      );
    }
  } catch {
    // Silencio intencional: es cosmético.
  }
}

/**
 * Avisa al WhatsApp personal del dueño (p. ej. cuando se agenda una cita nueva).
 *
 * Fire-and-forget total: si el dueño no tiene ownerPhone, o Meta rechaza el envío
 * porque la ventana de 24 h está cerrada (este mensaje lo inicia el negocio, no el
 * dueño), solo queda un warning en el log. JAMÁS afecta la conversación con el paciente.
 *
 * Limitación conocida y su salida: ver README (plantilla de utilidad, Fase 2).
 */
export async function notifyOwner(business: Business, text: string): Promise<void> {
  if (!business.ownerPhone) return;

  try {
    const ok = await sendText(business, business.ownerPhone, text);
    if (!ok) {
      logger.warn(
        { businessId: business.id, ownerPhone: maskPhone(business.ownerPhone) },
        "No se pudo avisar al dueño (¿ventana de 24 h cerrada?). La cita sí quedó guardada.",
      );
    }
  } catch (err) {
    logger.warn({ businessId: business.id, err }, "Error avisando al dueño; se ignora");
  }
}
