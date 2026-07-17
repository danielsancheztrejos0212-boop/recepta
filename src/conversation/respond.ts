import { prisma } from "../db/client";
import { logger, maskPhone } from "../lib/logger";
import { sendText } from "../whatsapp/send";
import { runAgent } from "./agent";

/** Cuántas entradas de historial le damos al modelo (suficiente contexto sin quemar tokens). */
const MAX_HISTORIAL = 24;

/**
 * Junta los mensajes que el paciente mandó en ráfaga, llama al agente y responde UNA sola vez.
 *
 * REGLA DE ORO: la conversación trae su businessId y todo (agente, tools, envío) cuelga
 * de ese negocio. Nunca se consulta ni se escribe nada de otro consultorio.
 *
 * Contrato: nunca lanza — la llama el timer del debounce, y un error aquí no puede
 * tumbar el proceso.
 */
export async function respondToConversation(conversationId: string): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { business: true, customer: true },
    });

    if (!conversation) {
      logger.warn({ conversationId }, "La conversación ya no existe; no hay a quién responder");
      return;
    }
    if (!conversation.business.active) {
      logger.warn(
        { conversationId, businessId: conversation.businessId },
        "El consultorio está inactivo; no se responde",
      );
      return;
    }

    // 1. ¿Hay algo sin responder? Si no, otro timer ya se encargó.
    const pendientes = await prisma.message.findMany({
      where: { conversationId, direction: "in", answered: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (pendientes.length === 0) return;

    // 2. Historial cronológico para el contexto del modelo.
    const historialDesc = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORIAL,
      select: { direction: true, content: true },
    });
    const history = historialDesc.reverse();

    // 3. Una sola respuesta para toda la ráfaga.
    const texto = await runAgent({
      business: conversation.business,
      customer: conversation.customer,
      history,
    });

    const enviado = await sendText(conversation.business, conversation.customer.waPhone, texto);

    // 4. Persistencia atómica: guardar la respuesta y marcar lo pendiente como respondido.
    //    Si el envío falló, NO marcamos nada: así el próximo mensaje del paciente reintenta.
    if (!enviado) {
      logger.warn(
        { conversationId, to: maskPhone(conversation.customer.waPhone) },
        "No se pudo enviar la respuesta; los mensajes quedan pendientes para el próximo intento",
      );
      return;
    }

    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId, direction: "out", content: texto, answered: true },
      }),
      prisma.message.updateMany({
        where: { id: { in: pendientes.map((m) => m.id) } },
        data: { answered: true },
      }),
    ]);

    logger.info(
      { conversationId, businessId: conversation.businessId, agrupados: pendientes.length },
      "Respuesta enviada y conversación actualizada",
    );
  } catch (err) {
    logger.error({ conversationId, err }, "Error respondiendo la conversación");
  }
}
