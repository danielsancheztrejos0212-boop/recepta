import { describe, expect, it } from "vitest";
import { limpiarRespuesta } from "../src/conversation/agent";

/**
 * Regresión de una fuga vista EN VIVO contra Groq: Llama a veces escribe la llamada
 * a la tool como texto plano en vez de usar el campo `tool_calls`. Sin limpiar, el
 * paciente recibe etiquetas XML y JSON interno por WhatsApp.
 */
describe("limpiarRespuesta", () => {
  it("quita el bloque <function=…> que Llama escribió en el texto (caso real)", () => {
    const real =
      'No, lamentablemente no ofrecemos depilación láser. ¿Prefieres que guarde tu interés? <function=guardar_lead>{"calificado": false, "interes": "depilacion laser", "contacto": "WhatsApp"}</function>';

    const limpio = limpiarRespuesta(real);

    expect(limpio).not.toContain("<function");
    expect(limpio).not.toContain("guardar_lead");
    expect(limpio).not.toContain("{");
    expect(limpio).toContain("no ofrecemos depilación láser");
    expect(limpio).toContain("¿Prefieres que guarde tu interés?");
  });

  it("quita bloques <tool_call>", () => {
    const texto = 'Listo 👍 <tool_call>{"name":"agendar_cita","arguments":{}}</tool_call>';
    const limpio = limpiarRespuesta(texto);

    expect(limpio).toBe("Listo 👍");
  });

  it("quita el marcador <|python_tag|> y todo lo que le siga", () => {
    const texto = 'Con gusto.<|python_tag|>{"name": "agendar_cita"}';
    expect(limpiarRespuesta(texto)).toBe("Con gusto.");
  });

  it("quita una etiqueta <function=…> sin cerrar", () => {
    const texto = 'Claro que sí <function=guardar_lead>{"interes":"botox"}';
    const limpio = limpiarRespuesta(texto);

    expect(limpio).not.toContain("<function");
    expect(limpio).not.toContain("botox");
    expect(limpio).toContain("Claro que sí");
  });

  it("no toca una respuesta normal", () => {
    const normal = "Hola María 👋 La limpieza facial cuesta 120.000 COP y dura 45 min. ¿Te agendo?";
    expect(limpiarRespuesta(normal)).toBe(normal);
  });

  it("no se come signos ni emojis legítimos", () => {
    const texto = "¿Te sirve mañana a las 3:00 pm? 😊";
    expect(limpiarRespuesta(texto)).toBe(texto);
  });

  it("devuelve vacío si el mensaje era SOLO la fuga (el caller usa el fallback)", () => {
    const texto = '<function=guardar_lead>{"interes":"x"}</function>';
    expect(limpiarRespuesta(texto)).toBe("");
  });

  it("limpia varias fugas en el mismo mensaje", () => {
    const texto = 'Uno <function=a>{"x":1}</function> y dos <function=b>{"y":2}</function> listo';
    const limpio = limpiarRespuesta(texto);

    expect(limpio).not.toContain("<function");
    expect(limpio).toContain("Uno");
    expect(limpio).toContain("listo");
  });
});
