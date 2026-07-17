import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { answerChallenge, verifySignature } from "../src/whatsapp/verify";

// Deben coincidir con los valores de vitest.config.ts.
const APP_SECRET = "secreto-de-app-de-prueba";
const VERIFY_TOKEN = "token-de-verificacion-de-prueba";

function firmar(body: Buffer | string, secreto = APP_SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secreto).update(body).digest("hex");
}

describe("verifySignature", () => {
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

  it("acepta una firma correcta", () => {
    expect(verifySignature(body, firmar(body))).toBe(true);
  });

  it("rechaza si el body fue alterado después de firmar", () => {
    const firma = firmar(body);
    const alterado = Buffer.from(JSON.stringify({ object: "hackeado", entry: [] }));
    expect(verifySignature(alterado, firma)).toBe(false);
  });

  it("rechaza si la firma se hizo con otro secreto", () => {
    expect(verifySignature(body, firmar(body, "secreto-equivocado"))).toBe(false);
  });

  it("rechaza cuando no viene el header", () => {
    expect(verifySignature(body, undefined)).toBe(false);
  });

  it("rechaza un header vacío o sin el prefijo sha256=", () => {
    expect(verifySignature(body, "")).toBe(false);
    expect(verifySignature(body, crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex"))).toBe(false);
    expect(verifySignature(body, "sha1=abcdef")).toBe(false);
  });

  it("rechaza una firma de largo distinto sin lanzar (timingSafeEqual explota si difieren)", () => {
    expect(verifySignature(body, "sha256=abc")).toBe(false);
  });

  it("rechaza basura no hexadecimal sin lanzar", () => {
    expect(verifySignature(body, "sha256=" + "z".repeat(64))).toBe(false);
  });

  it("rechaza si no hay body", () => {
    expect(verifySignature(undefined, firmar(body))).toBe(false);
  });

  it("es sensible a los bytes exactos: reserializar el JSON invalida la firma", () => {
    // Este es el bug clásico: parsear y volver a serializar cambia los bytes.
    const original = Buffer.from('{"a":1, "b":2}');
    const firma = firmar(original);
    const reserializado = Buffer.from(JSON.stringify(JSON.parse(original.toString())));
    expect(verifySignature(reserializado, firma)).toBe(false);
  });
});

describe("answerChallenge", () => {
  it("devuelve el challenge cuando el token es correcto", () => {
    const challenge = answerChallenge({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "1158201444",
    });
    expect(challenge).toBe("1158201444");
  });

  it("devuelve null con un token incorrecto", () => {
    const challenge = answerChallenge({
      "hub.mode": "subscribe",
      "hub.verify_token": "token-equivocado",
      "hub.challenge": "1158201444",
    });
    expect(challenge).toBeNull();
  });

  it("devuelve null si el modo no es subscribe", () => {
    expect(
      answerChallenge({
        "hub.mode": "unsubscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "123",
      }),
    ).toBeNull();
  });

  it("devuelve null con entradas raras y no lanza", () => {
    expect(answerChallenge(null)).toBeNull();
    expect(answerChallenge(undefined)).toBeNull();
    expect(answerChallenge({})).toBeNull();
    expect(answerChallenge("hola")).toBeNull();
    expect(answerChallenge({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN })).toBeNull();
  });
});
