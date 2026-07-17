import { PrismaClient } from "@prisma/client";

/**
 * Singleton de Prisma.
 * En dev, `tsx watch` recarga el módulo en cada cambio; guardamos la instancia en
 * globalThis para no abrir una conexión nueva a Neon en cada recarga (el plan free
 * tiene un límite bajo de conexiones).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
