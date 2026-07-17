import type { Business } from "@prisma/client";
import { prisma } from "../db/client";
import { logger } from "../lib/logger";

/**
 * REGLA DE ORO DEL PROYECTO
 * ─────────────────────────
 * El phone_number_id del webhook es lo ÚNICO que identifica al consultorio.
 * A partir de aquí, toda consulta a la BD en el flujo conversacional y en las tools
 * DEBE filtrar por businessId. Jamás mezclar datos entre consultorios.
 */
export async function resolveBusiness(phoneNumberId: string): Promise<Business | null> {
  try {
    const business = await prisma.business.findFirst({
      where: { wabaPhoneNumberId: phoneNumberId, active: true },
    });

    if (!business) {
      logger.warn(
        { phoneNumberId },
        "Llegó un mensaje de un phone_number_id sin consultorio activo; se ignora",
      );
      return null;
    }

    return business;
  } catch (err) {
    logger.error({ phoneNumberId, err }, "Error resolviendo el consultorio");
    return null;
  }
}
