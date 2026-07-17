import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { logger } from "../lib/logger";

/**
 * SELECT explícito para los consultorios.
 * `accessToken` NO está aquí y no debe estarlo nunca: es un secreto de Meta que no
 * puede salir por la API ni siquiera hacia el panel del admin (es write-only).
 */
const businessSelect = {
  id: true,
  name: true,
  type: true,
  wabaPhoneNumberId: true,
  timezone: true,
  active: true,
  ownerPhone: true,
  systemPromptConfig: true,
  createdAt: true,
  updatedAt: true,
} as const;

const servicioSchema = z.object({
  nombre: z.string().default(""),
  precio: z.string().default(""),
  duracion: z.string().default(""),
});

const promptConfigSchema = z.object({
  tipo: z.string().optional(),
  direccion: z.string().optional(),
  horario: z.string().optional(),
  personalidad: z.string().optional(),
  servicios: z.array(servicioSchema).optional(),
  preguntasCita: z.array(z.string()).optional(),
  infoAdicional: z.string().optional(),
});

const businessCreateSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  type: z.string().min(1, "El tipo de consultorio es obligatorio"),
  wabaPhoneNumberId: z.string().min(1, "El phone number ID de Meta es obligatorio"),
  accessToken: z.string().min(1, "El token de acceso es obligatorio"),
  timezone: z.string().min(1).default("America/Bogota"),
  active: z.boolean().default(true),
  // Formato internacional sin "+": solo dígitos. Vacío = sin avisos.
  ownerPhone: z
    .string()
    .regex(/^\d{8,15}$/, "El WhatsApp del dueño debe ser solo dígitos, sin '+' (ej. 573001112233)")
    .optional()
    .or(z.literal("")),
  systemPromptConfig: promptConfigSchema.default({}),
});

// En update todo es opcional; accessToken vacío = conservar el que ya está guardado.
const businessUpdateSchema = businessCreateSchema.partial().extend({
  accessToken: z.string().optional(),
});

const appointmentPatchSchema = z.object({
  status: z.enum(["pendiente", "confirmada", "cancelada", "atendida"], {
    message: "El estado debe ser pendiente, confirmada, cancelada o atendida",
  }),
});

/** Comparación en tiempo constante del token del panel. */
function tokenValido(recibido: string): boolean {
  const a = Buffer.from(recibido, "utf8");
  const b = Buffer.from(env.ADMIN_TOKEN, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function errorZod(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({
    error: "Datos inválidos",
    detalles: error.issues.map((i) => ({ campo: i.path.join(".") || "(raíz)", mensaje: i.message })),
  });
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Toda la API admin exige Bearer ADMIN_TOKEN.
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization;

    if (typeof auth !== "string" || !auth.startsWith("Bearer ") || !tokenValido(auth.slice(7))) {
      logger.warn({ url: request.url }, "Intento de acceso al panel sin token válido");
      return reply.code(401).send({ error: "No autorizado" });
    }
  });

  /** Sirve para validar la clave en la pantalla de login. */
  app.get("/admin/api/ping", async () => ({ ok: true }));

  /** Chips de arriba. Si llega businessId, todo se filtra a ese consultorio. */
  app.get("/admin/api/stats", async (request: FastifyRequest) => {
    const { businessId } = request.query as { businessId?: string };
    const filtro = businessId ? { businessId } : {};

    const [businesses, conversations, appointments, leads] = await Promise.all([
      prisma.business.count(),
      prisma.conversation.count({ where: filtro }),
      prisma.appointment.count({ where: filtro }),
      prisma.lead.count({ where: filtro }),
    ]);

    return { businesses, conversations, appointments, leads };
  });

  // ── Consultorios ───────────────────────────────────────────────────────────

  app.get("/admin/api/businesses", async () =>
    prisma.business.findMany({ select: businessSelect, orderBy: { createdAt: "desc" } }),
  );

  app.post("/admin/api/businesses", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = businessCreateSchema.safeParse(request.body);
    if (!parsed.success) return errorZod(reply, parsed.error);

    const { ownerPhone, ...resto } = parsed.data;

    try {
      const creado = await prisma.business.create({
        data: { ...resto, ownerPhone: ownerPhone ? ownerPhone : null },
        select: businessSelect,
      });
      logger.info({ businessId: creado.id }, "Consultorio creado desde el panel");
      return reply.code(201).send(creado);
    } catch (err) {
      if (esP2002(err)) {
        return reply
          .code(409)
          .send({ error: "Ya existe un consultorio con ese phone number ID de Meta" });
      }
      throw err;
    }
  });

  app.put("/admin/api/businesses/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parsed = businessUpdateSchema.safeParse(request.body);
    if (!parsed.success) return errorZod(reply, parsed.error);

    const { accessToken, ownerPhone, ...resto } = parsed.data;

    // Token write-only: si llega vacío, se conserva el que ya está en la BD.
    const data: Record<string, unknown> = { ...resto };
    if (accessToken && accessToken.trim().length > 0) data.accessToken = accessToken.trim();
    if (ownerPhone !== undefined) data.ownerPhone = ownerPhone ? ownerPhone : null;

    try {
      const actualizado = await prisma.business.update({
        where: { id },
        data,
        select: businessSelect,
      });
      logger.info({ businessId: id }, "Consultorio actualizado desde el panel");
      return actualizado;
    } catch (err) {
      if (esP2025(err)) return reply.code(404).send({ error: "Consultorio no encontrado" });
      if (esP2002(err)) {
        return reply
          .code(409)
          .send({ error: "Ya existe un consultorio con ese phone number ID de Meta" });
      }
      throw err;
    }
  });

  // ── Conversaciones ─────────────────────────────────────────────────────────

  app.get("/admin/api/conversations", async (request: FastifyRequest) => {
    const { businessId } = request.query as { businessId?: string };

    const conversaciones = await prisma.conversation.findMany({
      where: businessId ? { businessId } : {},
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        customer: { select: { id: true, name: true, waPhone: true } },
        business: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    return conversaciones.map((c) => ({
      id: c.id,
      status: c.status,
      updatedAt: c.updatedAt,
      business: c.business,
      customer: c.customer,
      lastMessage: c.messages[0]
        ? {
            content: c.messages[0].content,
            direction: c.messages[0].direction,
            createdAt: c.messages[0].createdAt,
          }
        : null,
    }));
  });

  app.get("/admin/api/conversations/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const conversacion = await prisma.conversation.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, waPhone: true } },
        business: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversacion) return reply.code(404).send({ error: "Conversación no encontrada" });

    return {
      id: conversacion.id,
      status: conversacion.status,
      business: conversacion.business,
      customer: conversacion.customer,
      messages: conversacion.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  });

  // ── Citas ──────────────────────────────────────────────────────────────────

  app.get("/admin/api/appointments", async (request: FastifyRequest) => {
    const { businessId } = request.query as { businessId?: string };

    return prisma.appointment.findMany({
      where: businessId ? { businessId } : {},
      orderBy: [{ date: "desc" }, { time: "desc" }],
      take: 200,
      include: {
        customer: { select: { name: true, waPhone: true } },
        business: { select: { id: true, name: true } },
      },
    });
  });

  app.patch("/admin/api/appointments/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parsed = appointmentPatchSchema.safeParse(request.body);
    if (!parsed.success) return errorZod(reply, parsed.error);

    try {
      return await prisma.appointment.update({
        where: { id },
        data: { status: parsed.data.status },
      });
    } catch (err) {
      if (esP2025(err)) return reply.code(404).send({ error: "Cita no encontrada" });
      throw err;
    }
  });

  // ── Leads ──────────────────────────────────────────────────────────────────

  app.get("/admin/api/leads", async (request: FastifyRequest) => {
    const { businessId } = request.query as { businessId?: string };

    return prisma.lead.findMany({
      where: businessId ? { businessId } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        customer: { select: { name: true, waPhone: true } },
        business: { select: { id: true, name: true } },
      },
    });
  });
}

// Prisma no exporta tipos de error usables con instanceof sin importar todo el runtime;
// mirar el código es suficiente y no acopla el panel al cliente generado.
function esP2002(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
function esP2025(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025";
}
