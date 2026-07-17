import type { Business, Customer } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/client";
import { logger, maskPhone } from "../lib/logger";
import { notifyOwner } from "../whatsapp/send";

/**
 * REGLA DE ORO: toda escritura aquí va amarrada al businessId y customerId del
 * contexto actual — NUNCA a un id que venga en los argumentos del modelo.
 * El modelo elige QUÉ guardar; nosotros decidimos A QUIÉN pertenece.
 */
export interface ToolContext {
  business: Business;
  customer: Customer;
}

/** Definiciones en formato de tools de OpenAI (el que consume Groq). */
export const toolDefs = [
  {
    type: "function" as const,
    function: {
      name: "agendar_cita",
      description:
        "Agenda una cita para el paciente en este consultorio. Úsala UNA sola vez, solo cuando ya tengas todos los datos necesarios (nombre, servicio, fecha y hora).",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre completo del paciente." },
          servicio: {
            type: "string",
            description: "Servicio o motivo de la cita, tal como lo ofrece el consultorio.",
          },
          fecha: {
            type: "string",
            description: "Fecha de la cita en formato YYYY-MM-DD (ej. 2026-07-20).",
          },
          hora: {
            type: "string",
            description: "Hora de la cita en formato de 24 horas HH:MM (ej. 15:30).",
          },
          telefono: {
            type: "string",
            description: "Teléfono de contacto, solo si el paciente da uno distinto al de WhatsApp.",
          },
          notas: {
            type: "string",
            description: "Cualquier detalle extra relevante para el consultorio.",
          },
        },
        required: ["nombre", "servicio", "fecha", "hora"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "guardar_lead",
      description:
        "Guarda los datos de un interesado para que una persona del equipo lo contacte. Úsala cuando no puedas resolver algo (precio o servicio que no conoces, duda médica, reclamo) o cuando el paciente muestre interés pero no quiera agendar todavía.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del interesado, si lo dio." },
          interes: {
            type: "string",
            description: "Qué necesita o qué preguntó, en una frase.",
          },
          contacto: {
            type: "string",
            description: "Cómo contactarlo (teléfono, correo). Si no dio otro, usa su WhatsApp.",
          },
          calificado: {
            type: "boolean",
            description:
              "true si mostró intención real de agendar o comprar; false si solo preguntaba.",
          },
          notas: { type: "string", description: "Contexto adicional útil para el equipo." },
        },
        required: ["interes", "contacto", "calificado"],
      },
    },
  },
];

// ── Validación de argumentos (el modelo puede alucinar cualquier cosa) ─────────

const agendarSchema = z.object({
  nombre: z.string().min(1, "falta el nombre"),
  servicio: z.string().min(1, "falta el servicio"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "la fecha debe ser YYYY-MM-DD"),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "la hora debe ser HH:MM en formato 24h"),
  telefono: z.string().optional(),
  notas: z.string().optional(),
});

const leadSchema = z.object({
  nombre: z.string().optional(),
  interes: z.string().min(1, "falta el interés"),
  contacto: z.string().min(1, "falta el contacto"),
  calificado: z.coerce.boolean(),
  notas: z.string().optional(),
});

/** Respuesta uniforme para el modelo: SIEMPRE un string JSON, nunca una excepción. */
function ok(data: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...data });
}
function fail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

/**
 * Ejecuta la tool que pidió el modelo.
 * Contrato: nunca lanza. Cualquier fallo vuelve como {"ok":false,"error":"..."}
 * para que el agente pueda explicárselo al paciente en vez de romperse.
 */
export async function executeTool(
  name: string,
  argsJson: string,
  ctx: ToolContext,
): Promise<string> {
  let args: unknown;
  try {
    args = JSON.parse(argsJson || "{}");
  } catch {
    return fail("Los argumentos no son JSON válido. Vuelve a intentarlo con el formato correcto.");
  }

  try {
    switch (name) {
      case "agendar_cita":
        return await agendarCita(args, ctx);
      case "guardar_lead":
        return await guardarLead(args, ctx);
      default:
        return fail(`La herramienta "${name}" no existe.`);
    }
  } catch (err) {
    logger.error({ tool: name, businessId: ctx.business.id, err }, "Error ejecutando tool");
    return fail("Hubo un problema guardando el dato. Dile al paciente que lo intentas en un momento.");
  }
}

async function agendarCita(args: unknown, ctx: ToolContext): Promise<string> {
  const parsed = agendarSchema.safeParse(args);
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { nombre, servicio, fecha, hora, notas } = parsed.data;

  /**
   * IDEMPOTENCIA — no confiar en el modelo.
   *
   * El historial que recibe el agente son solo los mensajes de texto: sus llamadas a
   * tools NO se persisten, así que en el turno siguiente no recuerda que ya agendó.
   * Visto en vivo: el paciente dice "sí, confirmo" después de agendar y el modelo
   * vuelve a llamar esta tool → cita duplicada y dos avisos al dueño.
   *
   * Por eso la garantía vive aquí, en la BD, y no en el prompt: si ya hay una cita
   * viva del mismo paciente a la misma fecha y hora, la devolvemos en vez de crear otra.
   * (Las canceladas no cuentan: el paciente sí puede re-agendar ese mismo horario.)
   */
  const existente = await prisma.appointment.findFirst({
    where: {
      businessId: ctx.business.id,
      customerId: ctx.customer.id,
      date: fecha,
      time: hora,
      status: { not: "cancelada" },
    },
  });

  if (existente) {
    logger.info(
      { businessId: ctx.business.id, citaId: existente.id },
      "[tool] cita duplicada evitada: ya existía para esa fecha y hora",
    );
    return ok({
      mensaje: "Esta cita YA estaba agendada. No la agendes de nuevo: solo confírmasela al paciente.",
      cita: {
        id: existente.id,
        fecha: existente.date,
        hora: existente.time,
        servicio: existente.serviceName,
      },
      yaExistia: true,
    });
  }

  // businessId y customerId salen del contexto, jamás de los argumentos del modelo.
  const cita = await prisma.appointment.create({
    data: {
      businessId: ctx.business.id,
      customerId: ctx.customer.id,
      serviceName: servicio,
      date: fecha,
      time: hora,
      notes: notas ?? null,
      status: "pendiente",
    },
  });

  // Si no teníamos el nombre del paciente, aprovechamos el que dio al agendar.
  if (!ctx.customer.name && nombre) {
    await prisma.customer
      .update({ where: { id: ctx.customer.id }, data: { name: nombre } })
      .catch(() => {
        /* que falle el nombre no invalida la cita */
      });
  }

  logger.info(
    { businessId: ctx.business.id, citaId: cita.id, fecha, hora },
    "[tool] cita agendada",
  );

  // Aviso al dueño: fire-and-forget puro. No hacemos await para no demorar la
  // respuesta al paciente, y un fallo aquí jamás invalida la cita.
  const aviso =
    `🗓️ Nueva cita — ${ctx.business.name}\n` +
    `👤 Paciente: ${nombre}\n` +
    `📅 Fecha: ${fecha} a las ${hora}\n` +
    `📝 Motivo: ${servicio}${notas ? ` — ${notas}` : ""}`;

  void notifyOwner(ctx.business, aviso);

  return ok({
    mensaje: "Cita agendada correctamente.",
    cita: { id: cita.id, fecha, hora, servicio },
  });
}

async function guardarLead(args: unknown, ctx: ToolContext): Promise<string> {
  const parsed = leadSchema.safeParse(args);
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const { nombre, interes, contacto, calificado, notas } = parsed.data;

  const lead = await prisma.lead.create({
    data: {
      businessId: ctx.business.id,
      customerId: ctx.customer.id,
      need: interes,
      contactInfo: contacto,
      qualified: calificado,
      notes: notas ?? null,
    },
  });

  if (!ctx.customer.name && nombre) {
    await prisma.customer
      .update({ where: { id: ctx.customer.id }, data: { name: nombre } })
      .catch(() => {
        /* no crítico */
      });
  }

  logger.info(
    { businessId: ctx.business.id, leadId: lead.id, contacto: maskPhone(contacto), calificado },
    "[tool] lead guardado",
  );

  return ok({ mensaje: "Datos guardados. Una persona del equipo lo contactará." });
}
