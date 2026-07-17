import { describe, expect, it } from "vitest";
import { parseIncoming } from "../src/whatsapp/parse";

/** Payload real de Meta (Cloud API) para un mensaje de texto. */
const payloadTexto = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550783881",
              phone_number_id: "106540352242922",
            },
            contacts: [{ profile: { name: "María Gómez" }, wa_id: "573001112233" }],
            messages: [
              {
                from: "573001112233",
                id: "wamid.HBgMNTczMDAxMTEyMjMzFQIAEhgUM0E1RjhBQjk5MDA4RjJDNjJEQzUA",
                timestamp: "1731000000",
                text: { body: "Hola, ¿cuánto cuesta la limpieza facial?" },
                type: "text",
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

describe("parseIncoming", () => {
  it("normaliza un mensaje de texto real de Meta", () => {
    const mensajes = parseIncoming(payloadTexto);

    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toEqual({
      phoneNumberId: "106540352242922",
      from: "573001112233",
      waMessageId: "wamid.HBgMNTczMDAxMTEyMjMzFQIAEhgUM0E1RjhBQjk5MDA4RjJDNjJEQzUA",
      text: "Hola, ¿cuánto cuesta la limpieza facial?",
      type: "text",
      profileName: "María Gómez",
    });
  });

  it("ignora los eventos de estado (sent/delivered/read)", () => {
    const statuses = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "102290129340398",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
                statuses: [
                  {
                    id: "wamid.HBgM",
                    status: "delivered",
                    timestamp: "1731000001",
                    recipient_id: "573001112233",
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    expect(parseIncoming(statuses)).toEqual([]);
  });

  it("convierte un audio en un placeholder que el agente entiende", () => {
    const audio = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "106540352242922" },
                contacts: [{ profile: { name: "Juan" }, wa_id: "573009998877" }],
                messages: [
                  {
                    from: "573009998877",
                    id: "wamid.AUDIO123",
                    type: "audio",
                    audio: { id: "media-id-123", mime_type: "audio/ogg; codecs=opus" },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const mensajes = parseIncoming(audio);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].type).toBe("audio");
    expect(mensajes[0].text).toContain("audio");
    expect(mensajes[0].text).toContain("escriba en texto");
  });

  it("hace lo mismo con imágenes y stickers", () => {
    const conTipo = (type: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "1" },
                messages: [{ from: "57300", id: `wamid.${type}`, type }],
              },
            },
          ],
        },
      ],
    });

    expect(parseIncoming(conTipo("image"))[0].text).toContain("imagen");
    expect(parseIncoming(conTipo("sticker"))[0].text).toContain("sticker");
  });

  it("no lanza con payloads desconocidos, nulos o basura", () => {
    expect(parseIncoming(null)).toEqual([]);
    expect(parseIncoming(undefined)).toEqual([]);
    expect(parseIncoming({})).toEqual([]);
    expect(parseIncoming("hola")).toEqual([]);
    expect(parseIncoming(42)).toEqual([]);
    expect(parseIncoming({ entry: "no-es-un-array" })).toEqual([]);
    expect(parseIncoming({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });

  it("tolera campos nuevos que Meta agregue sin avisar", () => {
    const conExtras = JSON.parse(JSON.stringify(payloadTexto));
    conExtras.entry[0].changes[0].value.campo_nuevo_de_meta = { algo: true };
    conExtras.entry[0].changes[0].value.messages[0].otro_campo = "xyz";

    expect(parseIncoming(conExtras)).toHaveLength(1);
  });

  it("procesa varios mensajes en un solo webhook (ráfaga del paciente)", () => {
    const rafaga = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "106540352242922" },
                messages: [
                  { from: "573001112233", id: "wamid.1", type: "text", text: { body: "Hola" } },
                  { from: "573001112233", id: "wamid.2", type: "text", text: { body: "¿Están abiertos?" } },
                ],
              },
            },
          ],
        },
      ],
    };

    const mensajes = parseIncoming(rafaga);
    expect(mensajes).toHaveLength(2);
    expect(mensajes.map((m) => m.text)).toEqual(["Hola", "¿Están abiertos?"]);
  });

  it("descarta el mensaje si no viene el phone_number_id (no sabríamos de qué consultorio es)", () => {
    const sinId = {
      entry: [
        {
          changes: [
            { value: { messages: [{ from: "57300", id: "wamid.X", type: "text", text: { body: "Hola" } }] } },
          ],
        },
      ],
    };

    expect(parseIncoming(sinId)).toEqual([]);
  });
});
