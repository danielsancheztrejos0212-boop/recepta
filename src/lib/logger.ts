import pino from "pino";

/**
 * Logger estructurado.
 *
 * Reglas de privacidad (Ley 1581 de habeas data):
 *  - Los tokens nunca se imprimen (redact).
 *  - Los teléfonos van enmascarados: solo los últimos 4 dígitos.
 *  - El texto completo de los mensajes de pacientes NO se loguea en nivel info.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "accessToken",
      "*.accessToken",
      "business.accessToken",
      "authorization",
      "*.authorization",
      "req.headers.authorization",
      "headers.authorization",
      "GROQ_API_KEY",
      "ADMIN_TOKEN",
      "WHATSAPP_APP_SECRET",
    ],
    censor: "[REDACTADO]",
  },
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

/**
 * Deja visibles solo los últimos 4 dígitos de un teléfono.
 * "573001234567" → "********4567"
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "(sin teléfono)";
  const limpio = phone.trim();
  if (limpio.length <= 4) return "*".repeat(limpio.length);
  return "*".repeat(limpio.length - 4) + limpio.slice(-4);
}
