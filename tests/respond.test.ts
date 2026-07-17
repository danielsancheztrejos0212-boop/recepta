import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client", () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    message: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("../src/whatsapp/send", () => ({ sendText: vi.fn() }));
vi.mock("../src/conversation/agent", () => ({ runAgent: vi.fn() }));

import { prisma } from "../src/db/client";
import { sendText } from "../src/whatsapp/send";
import { runAgent } from "../src/conversation/agent";
import { respondToConversation } from "../src/conversation/respond";

const CONV = "conv_1";

const conversacionBase = {
  id: CONV,
  businessId: "biz_1",
  customerId: "cus_1",
  status: "abierta",
  business: { id: "biz_1", name: "Clínica Bella Piel", active: true, accessToken: "tok" },
  customer: { id: "cus_1", waPhone: "573001112233", name: "María" },
};

/** La ráfaga típica: tres mensajes seguidos sin responder. */
const pendientes = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];

function prepararRafaga() {
  vi.mocked(prisma.conversation.findUnique).mockResolvedValue(conversacionBase as never);
  vi.mocked(prisma.message.findMany)
    .mockResolvedValueOnce(pendientes as never) // los sin responder
    .mockResolvedValueOnce([
      { direction: "in", content: "Hola" },
      { direction: "in", content: "quiero una cita" },
    ] as never); // el historial
  vi.mocked(runAgent).mockResolvedValue("¡Claro! ¿Para qué servicio?");
}

describe("respondToConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * EL CAMINO FELIZ. Nunca se había ejecutado en las pruebas reales: con un token de
   * relleno, Meta siempre devolvía 401, `sendText` daba false y la función salía antes
   * de llegar aquí. Es exactamente lo que ocurrirá en producción con un token válido.
   */
  it("cuando el envío funciona: responde UNA vez, guarda la salida y marca la ráfaga", async () => {
    prepararRafaga();
    vi.mocked(sendText).mockResolvedValue(true);

    await respondToConversation(CONV);

    // Una sola respuesta para los tres mensajes.
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledWith(
      conversacionBase.business,
      "573001112233",
      "¡Claro! ¿Para qué servicio?",
    );

    // Se guarda la respuesta del agente…
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: CONV,
        direction: "out",
        content: "¡Claro! ¿Para qué servicio?",
        answered: true,
      },
    });

    // …y se marcan los TRES entrantes, no solo el último.
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2", "m3"] } },
      data: { answered: true },
    });

    // Ambas cosas en la misma transacción: o las dos, o ninguna.
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("si el envío falla, NO marca nada (así el próximo mensaje reintenta)", async () => {
    prepararRafaga();
    vi.mocked(sendText).mockResolvedValue(false);

    await respondToConversation(CONV);

    expect(sendText).toHaveBeenCalledOnce();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });

  it("sin mensajes pendientes no molesta al agente (ahorra cuota de Groq)", async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue(conversacionBase as never);
    vi.mocked(prisma.message.findMany).mockResolvedValueOnce([] as never);

    await respondToConversation(CONV);

    expect(runAgent).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("no responde si el consultorio está inactivo", async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      ...conversacionBase,
      business: { ...conversacionBase.business, active: false },
    } as never);

    await respondToConversation(CONV);

    expect(runAgent).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("el historial le llega al agente en orden cronológico", async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue(conversacionBase as never);
    vi.mocked(prisma.message.findMany)
      .mockResolvedValueOnce(pendientes as never)
      // La BD lo devuelve del más nuevo al más viejo (orden desc).
      .mockResolvedValueOnce([
        { direction: "in", content: "el tercero" },
        { direction: "out", content: "el segundo" },
        { direction: "in", content: "el primero" },
      ] as never);
    vi.mocked(runAgent).mockResolvedValue("ok");
    vi.mocked(sendText).mockResolvedValue(true);

    await respondToConversation(CONV);

    const { history } = vi.mocked(runAgent).mock.calls[0][0];
    expect(history.map((h) => h.content)).toEqual(["el primero", "el segundo", "el tercero"]);
  });

  it("si la conversación ya no existe, no lanza", async () => {
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue(null);

    await expect(respondToConversation(CONV)).resolves.toBeUndefined();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("si la BD explota, no propaga: el timer del debounce no puede tumbar el proceso", async () => {
    vi.mocked(prisma.conversation.findUnique).mockRejectedValue(new Error("Neon caído"));

    await expect(respondToConversation(CONV)).resolves.toBeUndefined();
  });
});
