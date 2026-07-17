import type { Business } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendText } from "../src/whatsapp/send";
import { logger } from "../src/lib/logger";

/**
 * Regresión de una fuga real encontrada probando contra la Graph API de verdad:
 * cuando el token es inválido, Meta responde con el token ECHADO DE VUELTA dentro
 * del mensaje de error. Loguear la respuesta cruda filtraba el secreto del consultorio.
 *
 * El `redact` de pino no protege de esto: mira rutas de objetos, no strings.
 */
const TOKEN = "EAAG_super_secreto_del_consultorio_123";

const business = {
  id: "biz_1",
  name: "Clínica Bella Piel",
  type: "clínica estética",
  wabaPhoneNumberId: "555000111",
  accessToken: TOKEN,
  timezone: "America/Bogota",
  active: true,
  ownerPhone: null,
  systemPromptConfig: {},
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Business;

describe("sendText — higiene de logs", () => {
  let logueado: string;

  beforeEach(() => {
    logueado = "";
    // Capturamos lo que pino recibiría, tal cual.
    vi.spyOn(logger, "error").mockImplementation(((obj: unknown, msg?: string) => {
      logueado += JSON.stringify(obj) + " " + (msg ?? "");
      return logger;
    }) as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it("no filtra el accessToken cuando Meta lo devuelve en el error", async () => {
    // Respuesta real de Meta ante un token inválido (código 190).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: `Malformed access token ${TOKEN}`,
              type: "OAuthException",
              code: 190,
              fbtrace_id: "AdVyC1LtfnbRIJ99NLS3tVN",
            },
          }),
          { status: 401 },
        ),
      ),
    );

    const ok = await sendText(business, "573001112233", "Hola");

    expect(ok).toBe(false);
    expect(logueado).not.toContain(TOKEN);
    expect(logueado).toContain("[TOKEN_REDACTADO]");
    // El resto del error sí debe quedar: sin eso no se puede depurar nada.
    expect(logueado).toContain("OAuthException");
  });

  it("enmascara el teléfono del paciente en el log de error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    await sendText(business, "573001112233", "Hola");

    expect(logueado).not.toContain("573001112233");
    expect(logueado).toContain("2233"); // últimos 4 sí, para poder rastrear
  });

  it("devuelve true cuando Meta acepta el mensaje", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 })),
    );

    expect(await sendText(business, "573001112233", "Hola")).toBe(true);
  });

  it("no relanza si la red falla: el webhook nunca se cae por un envío", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));

    await expect(sendText(business, "573001112233", "Hola")).resolves.toBe(false);
  });
});
