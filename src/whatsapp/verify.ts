import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * GET /webhook/whatsapp — Meta manda un "challenge" al dar de alta el webhook.
 * Devolvemos el challenge tal cual si el verify_token coincide; si no, null (→ 403).
 */
export function answerChallenge(query: unknown): string | null {
  if (typeof query !== "object" || query === null) return null;

  const q = query as Record<string, unknown>;
  const mode = q["hub.mode"];
  const token = q["hub.verify_token"];
  const challenge = q["hub.challenge"];

  if (mode !== "subscribe") return null;
  if (typeof token !== "string" || typeof challenge !== "string") return null;

  // Comparación en tiempo constante también aquí: el verify_token es un secreto.
  if (!safeEqual(token, env.WHATSAPP_VERIFY_TOKEN)) return null;

  return challenge;
}

/**
 * POST /webhook/whatsapp — Meta firma el cuerpo con HMAC-SHA256 usando el App Secret.
 * Hay que calcular el HMAC sobre el body CRUDO (bytes exactos): si se reserializa
 * el JSON, la firma no coincide.
 *
 * Nunca lanza: cualquier entrada rara devuelve false.
 */
export function verifySignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
): boolean {
  try {
    if (!rawBody || !Buffer.isBuffer(rawBody)) return false;
    if (typeof signatureHeader !== "string" || signatureHeader.length === 0) return false;
    if (!signatureHeader.startsWith("sha256=")) return false;

    const recibida = signatureHeader.slice("sha256=".length);
    if (!/^[a-f0-9]+$/i.test(recibida)) return false;

    const esperada = crypto
      .createHmac("sha256", env.WHATSAPP_APP_SECRET)
      .update(rawBody)
      .digest("hex");

    return safeEqual(recibida.toLowerCase(), esperada.toLowerCase());
  } catch {
    return false;
  }
}

/** timingSafeEqual exige buffers del mismo largo; si difieren, no es igual. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
