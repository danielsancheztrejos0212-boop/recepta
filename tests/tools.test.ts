import type { Business, Customer } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock de Prisma: estos tests son sobre la LÓGICA de las tools, no sobre Postgres.
vi.mock("../src/db/client", () => ({
  prisma: {
    appointment: { findFirst: vi.fn(), create: vi.fn() },
    lead: { create: vi.fn() },
    customer: { update: vi.fn() },
  },
}));

// notifyOwner es fire-and-forget; aquí solo nos interesa cuántas veces se dispara.
vi.mock("../src/whatsapp/send", () => ({ notifyOwner: vi.fn(async () => undefined) }));

import { prisma } from "../src/db/client";
import { notifyOwner } from "../src/whatsapp/send";
import { executeTool } from "../src/conversation/tools";

const business = { id: "biz_1", name: "Clínica Bella Piel", ownerPhone: "573009998877" } as Business;
const customer = { id: "cus_1", name: null, waPhone: "573001112233" } as Customer;
const ctx = { business, customer };

const argsCita = JSON.stringify({
  nombre: "María Gómez",
  servicio: "Limpieza facial profunda",
  fecha: "2026-07-18",
  hora: "15:00",
});

describe("executeTool — agendar_cita", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("agenda cuando no hay una cita previa", async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.appointment.create).mockResolvedValue({ id: "apt_1" } as never);
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

    const res = JSON.parse(await executeTool("agendar_cita", argsCita, ctx));

    expect(res.ok).toBe(true);
    expect(prisma.appointment.create).toHaveBeenCalledOnce();
    expect(notifyOwner).toHaveBeenCalledOnce();
  });

  /**
   * Regresión de un bug visto en vivo contra Groq: el modelo no recuerda sus propias
   * llamadas a tools entre turnos, así que ante un "sí, confirmo" volvía a agendar.
   * La idempotencia tiene que estar en la BD, no en el prompt.
   */
  it("NO duplica si ya existe una cita del mismo paciente a la misma fecha y hora", async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: "apt_1",
      date: "2026-07-18",
      time: "15:00",
      serviceName: "Limpieza facial profunda",
    } as never);

    const res = JSON.parse(await executeTool("agendar_cita", argsCita, ctx));

    expect(res.ok).toBe(true);
    expect(res.yaExistia).toBe(true);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
    // Y el dueño NO recibe un segundo aviso por la misma cita.
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("una cita cancelada no bloquea re-agendar el mismo horario", async () => {
    // findFirst excluye las canceladas, así que devuelve null → se crea la nueva.
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.appointment.create).mockResolvedValue({ id: "apt_2" } as never);
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

    const res = JSON.parse(await executeTool("agendar_cita", argsCita, ctx));

    expect(res.ok).toBe(true);
    expect(prisma.appointment.create).toHaveBeenCalledOnce();
    const where = vi.mocked(prisma.appointment.findFirst).mock.calls[0][0]!.where!;
    expect(where.status).toEqual({ not: "cancelada" });
  });

  it("la cita se amarra al businessId del contexto, no a lo que diga el modelo", async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.appointment.create).mockResolvedValue({ id: "apt_3" } as never);
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

    // El modelo intenta colar otro consultorio.
    const malicioso = JSON.stringify({
      ...JSON.parse(argsCita),
      businessId: "biz_del_vecino",
      customerId: "cus_ajeno",
    });

    await executeTool("agendar_cita", malicioso, ctx);

    const data = vi.mocked(prisma.appointment.create).mock.calls[0][0]!.data as Record<string, unknown>;
    expect(data.businessId).toBe("biz_1");
    expect(data.customerId).toBe("cus_1");
  });

  it("rechaza una fecha con formato inválido sin lanzar", async () => {
    const res = JSON.parse(
      await executeTool("agendar_cita", JSON.stringify({ ...JSON.parse(argsCita), fecha: "mañana" }), ctx),
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain("YYYY-MM-DD");
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it("rechaza una hora inválida sin lanzar", async () => {
    const res = JSON.parse(
      await executeTool("agendar_cita", JSON.stringify({ ...JSON.parse(argsCita), hora: "3pm" }), ctx),
    );

    expect(res.ok).toBe(false);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it("devuelve error, no excepción, si la BD falla", async () => {
    vi.mocked(prisma.appointment.findFirst).mockRejectedValue(new Error("Postgres caído"));

    const res = JSON.parse(await executeTool("agendar_cita", argsCita, ctx));
    expect(res.ok).toBe(false);
  });
});

describe("executeTool — guardar_lead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda el lead amarrado al negocio del contexto", async () => {
    vi.mocked(prisma.lead.create).mockResolvedValue({ id: "lead_1" } as never);
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

    const res = JSON.parse(
      await executeTool(
        "guardar_lead",
        JSON.stringify({ interes: "botox", contacto: "573001112233", calificado: true }),
        ctx,
      ),
    );

    expect(res.ok).toBe(true);
    const data = vi.mocked(prisma.lead.create).mock.calls[0][0]!.data as Record<string, unknown>;
    expect(data.businessId).toBe("biz_1");
    expect(data.need).toBe("botox");
  });
});

describe("executeTool — robustez", () => {
  beforeEach(() => vi.clearAllMocks());

  it("una tool inexistente devuelve error, no excepción", async () => {
    const res = JSON.parse(await executeTool("borrar_todo", "{}", ctx));
    expect(res.ok).toBe(false);
  });

  it("argumentos que no son JSON devuelven error, no excepción", async () => {
    const res = JSON.parse(await executeTool("agendar_cita", "{esto no es json", ctx));
    expect(res.ok).toBe(false);
  });
});
