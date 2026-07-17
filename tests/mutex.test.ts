import { describe, expect, it } from "vitest";
import { candadosActivos, conCandado } from "../src/lib/mutex";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reproduce la carrera real del webhook: varios mensajes de la misma ráfaga
 * ejecutando "buscar conversación abierta, si no existe crearla" a la vez.
 * Sin candado se crean varias; con candado, una sola.
 */
describe("conCandado", () => {
  it("sin candado la carrera crea duplicados (demuestra el bug)", async () => {
    let conversaciones: string[] = [];

    const buscarOCrear = async () => {
      const existente = conversaciones[0];
      if (existente) return existente;
      await dormir(10); // la ventana de la carrera: el await entre leer y escribir
      conversaciones.push("conv");
      return "conv";
    };

    await Promise.all([buscarOCrear(), buscarOCrear(), buscarOCrear()]);
    expect(conversaciones.length).toBe(3); // 💥 tres conversaciones para un paciente
  });

  it("con candado, la misma carrera crea una sola", async () => {
    const conversaciones: string[] = [];

    const buscarOCrear = async () => {
      const existente = conversaciones[0];
      if (existente) return existente;
      await dormir(10);
      conversaciones.push("conv");
      return "conv";
    };

    await Promise.all([
      conCandado("biz:573001", buscarOCrear),
      conCandado("biz:573001", buscarOCrear),
      conCandado("biz:573001", buscarOCrear),
    ]);

    expect(conversaciones.length).toBe(1);
  });

  it("ejecuta en orden de llegada", async () => {
    const orden: number[] = [];

    await Promise.all([
      conCandado("k", async () => { await dormir(15); orden.push(1); }),
      conCandado("k", async () => { await dormir(1); orden.push(2); }),
      conCandado("k", async () => { orden.push(3); }),
    ]);

    expect(orden).toEqual([1, 2, 3]);
  });

  it("claves distintas no se bloquean entre sí (dos pacientes en paralelo)", async () => {
    const inicio = Date.now();

    await Promise.all([
      conCandado("paciente-a", () => dormir(40)),
      conCandado("paciente-b", () => dormir(40)),
    ]);

    // Si se serializaran, tardaría ~80 ms.
    expect(Date.now() - inicio).toBeLessThan(75);
  });

  it("si una tarea falla, las siguientes igual corren", async () => {
    const hechas: string[] = [];

    const fallida = conCandado("k2", async () => {
      throw new Error("la BD falló");
    });
    const siguiente = conCandado("k2", async () => {
      hechas.push("siguió");
    });

    await expect(fallida).rejects.toThrow("la BD falló");
    await siguiente;
    expect(hechas).toEqual(["siguió"]);
  });

  it("propaga el valor de retorno", async () => {
    await expect(conCandado("k3", async () => 42)).resolves.toBe(42);
  });

  it("no deja claves colgadas en memoria", async () => {
    await Promise.all([
      conCandado("temporal", () => dormir(5)),
      conCandado("temporal", () => dormir(5)),
    ]);
    await dormir(20);

    expect(candadosActivos()).toBe(0);
  });
});
