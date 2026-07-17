import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type Business } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { logger, maskPhone } from "../lib/logger";
import { conCandado } from "../lib/mutex";
import { answerChallenge, verifySignature } from "../whatsapp/verify";
import { parseIncoming, type IncomingMessage } from "../whatsapp/parse";
import { markReadAndTyping } from "../whatsapp/send";
import { resolveBusiness } from "../tenants/resolve";
import { scheduleReply } from "../conversation/debounce";

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /** Verificación del webhook: Meta llama esto una sola vez al darlo de alta. */
  app.get("/webhook/whatsapp", async (request: FastifyRequest, reply: FastifyReply) => {
    const challenge = answerChallenge(request.query);

    if (challenge === null) {
      logger.warn("Verificación de webhook rechazada (verify_token incorrecto)");
      return reply.code(403).send("Forbidden");
    }

    logger.info("Webhook verificado por Meta correctamente");
    return reply.code(200).type("text/plain").send(challenge);
  });

  /** Mensajes entrantes. */
  app.post("/webhook/whatsapp", async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Firma HMAC sobre el body CRUDO. Sin esto, cualquiera podría inventar mensajes.
    const firma = request.headers["x-hub-signature-256"];
    const valida = verifySignature(
      request.rawBody,
      typeof firma === "string" ? firma : undefined,
    );

    if (!valida) {
      logger.warn("Webhook con firma inválida o ausente: se rechaza");
      return reply.code(401).send("Invalid signature");
    }

    // 2. 200 inmediato: Meta reintenta (y termina desactivando el webhook) si nos demoramos.
    reply.code(200).type("text/plain").send("EVENT_RECEIVED");

    // 3. El trabajo real, ya fuera del ciclo de respuesta.
    const payload = request.body;
    setImmediate(() => {
      procesarPayload(payload).catch((err) => {
        logger.error({ err }, "Fallo no controlado procesando el webhook; el proceso sigue");
      });
    });
  });
}

async function procesarPayload(payload: unknown): Promise<void> {
  const mensajes = parseIncoming(payload);
  if (mensajes.length === 0) return;

  for (const msg of mensajes) {
    try {
      await procesarMensaje(msg);
    } catch (err) {
      // Un mensaje malo no puede arrastrar a los demás.
      logger.error({ err, from: maskPhone(msg.from) }, "Error procesando un mensaje entrante");
    }
  }
}

async function procesarMensaje(msg: IncomingMessage): Promise<void> {
  // Resolver el tenant: si el phone_number_id no es de ningún consultorio activo, ignorar.
  const business = await resolveBusiness(msg.phoneNumberId);
  if (!business) return;

  /**
   * Todo lo que sigue (upsert del paciente, buscar/crear conversación, guardar el
   * mensaje) va serializado POR PACIENTE. Sin esto, los mensajes de una ráfaga se
   * procesan en paralelo y crean conversaciones duplicadas — bug real, ver lib/mutex.ts.
   */
  await conCandado(`${business.id}:${msg.from}`, () => guardarMensaje(business, msg));
}

async function guardarMensaje(business: Business, msg: IncomingMessage): Promise<void> {
  // Upsert del paciente (único por consultorio + teléfono).
  const customer = await prisma.customer.upsert({
    where: { businessId_waPhone: { businessId: business.id, waPhone: msg.from } },
    create: {
      businessId: business.id,
      waPhone: msg.from,
      name: msg.profileName ?? null,
    },
    update: {},
  });

  // Conversación abierta o nueva.
  let conversation = await prisma.conversation.findFirst({
    where: { businessId: business.id, customerId: customer.id, status: "abierta" },
    orderBy: { createdAt: "desc" },
  });

  conversation ??= await prisma.conversation.create({
    data: { businessId: business.id, customerId: customer.id, status: "abierta" },
  });

  // Guardar el mensaje. waMessageId es único: si Meta reintenta el webhook, Prisma
  // lanza P2002 y eso significa "ya lo teníamos" → deduplicación silenciosa.
  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "in",
        content: msg.text,
        waMessageId: msg.waMessageId,
        answered: false,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.debug({ waMessageId: msg.waMessageId }, "Mensaje duplicado de Meta; se ignora");
      return;
    }
    throw err;
  }

  logger.info(
    { businessId: business.id, conversationId: conversation.id, from: maskPhone(msg.from) },
    "Mensaje entrante registrado",
  );

  // Efecto humano: leído + "escribiendo…" ya mismo, respuesta tras el debounce.
  void markReadAndTyping(business, msg.waMessageId);
  scheduleReply(conversation.id, env.RESPONSE_DELAY_MS);
}
