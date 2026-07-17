import { z } from "zod";

export interface IncomingMessage {
  phoneNumberId: string;
  from: string;
  waMessageId: string;
  text: string;
  type: string;
  profileName?: string;
}

/**
 * Schema PERMISIVO a propósito: Meta agrega campos nuevos sin avisar y no queremos
 * que eso rompa el webhook. Solo exigimos lo que realmente usamos.
 */
const contactSchema = z.object({
  wa_id: z.string().optional(),
  profile: z.object({ name: z.string().optional() }).loose().optional(),
});

const messageSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).loose().optional(),
  })
  .loose();

const valueSchema = z
  .object({
    metadata: z.object({ phone_number_id: z.string() }).loose().optional(),
    contacts: z.array(contactSchema.loose()).optional(),
    messages: z.array(messageSchema).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .loose();

const payloadSchema = z
  .object({
    object: z.string().optional(),
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(z.object({ field: z.string().optional(), value: valueSchema }).loose())
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

/** Nombre legible por tipo de adjunto, para el placeholder que ve el agente. */
const NOMBRE_TIPO: Record<string, string> = {
  audio: "audio",
  image: "imagen",
  video: "video",
  document: "documento",
  sticker: "sticker",
  location: "ubicación",
  contacts: "contacto",
  button: "botón",
  interactive: "respuesta interactiva",
  reaction: "reacción",
  order: "pedido",
  unknown: "desconocido",
};

/**
 * Normaliza el payload de Meta a una lista de IncomingMessage.
 *
 * Reglas:
 *  - Eventos de `statuses` (entregado/leído) → se ignoran (lista vacía).
 *  - Mensajes no-texto → placeholder para que el agente pida el mensaje por escrito.
 *  - Payload desconocido/null → lista vacía. JAMÁS lanza excepción.
 */
export function parseIncoming(payload: unknown): IncomingMessage[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const salida: IncomingMessage[] = [];

  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Notificaciones de estado (sent/delivered/read): no son mensajes del paciente.
      if (value.statuses && value.statuses.length > 0) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const mensajes = value.messages ?? [];
      if (mensajes.length === 0) continue;

      const profileName = value.contacts?.[0]?.profile?.name;

      for (const msg of mensajes) {
        const esTexto = msg.type === "text" && typeof msg.text?.body === "string";
        const texto = esTexto
          ? (msg.text!.body as string)
          : `[El cliente envió un mensaje de tipo ${NOMBRE_TIPO[msg.type] ?? msg.type} que no puedes ver. Pídele amablemente que lo escriba en texto.]`;

        salida.push({
          phoneNumberId,
          from: msg.from,
          waMessageId: msg.id,
          text: texto,
          type: msg.type,
          ...(profileName ? { profileName } : {}),
        });
      }
    }
  }

  return salida;
}
