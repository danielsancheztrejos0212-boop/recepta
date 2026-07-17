/**
 * Siembra una conversación de DEMO en la BD para poder ver el visor del panel.
 *
 * El agente es real (Groq): lo único simulado son los mensajes del "paciente".
 * Como todavía no hay token de Meta, no se puede mandar nada por WhatsApp, así que
 * persistimos aquí lo que el agente respondería.
 *
 * Para borrarla después:  npx tsx seed-demo.ts --borrar
 */
import { prisma } from "./src/db/client";
import { runAgent, type HistoryEntry } from "./src/conversation/agent";

const TELEFONO_DEMO = "573001112233";

async function borrar(businessId: string) {
  const customer = await prisma.customer.findFirst({
    where: { businessId, waPhone: TELEFONO_DEMO },
  });
  if (!customer) return console.log("No hay datos de demo que borrar.");

  // Cascade borra conversaciones, mensajes, citas y leads de este paciente.
  await prisma.customer.delete({ where: { id: customer.id } });
  console.log("🧹 Datos de demo borrados.");
}

async function main() {
  const business = await prisma.business.findFirst({ where: { active: true } });
  if (!business) throw new Error("No hay consultorio activo. Créalo en el panel primero.");

  if (process.argv.includes("--borrar")) {
    await borrar(business.id);
    return;
  }

  await borrar(business.id); // empezamos limpio

  const customer = await prisma.customer.create({
    data: { businessId: business.id, waPhone: TELEFONO_DEMO, name: "María Gómez" },
  });
  const conversation = await prisma.conversation.create({
    data: { businessId: business.id, customerId: customer.id, status: "abierta" },
  });

  const guion = [
    "Hola, buenas tardes",
    "vi que hacen limpieza facial, cuánto cuesta?",
    "y tienen botox?",
    "listo, quiero agendar la limpieza facial entonces",
    "María Gómez, mañana a las 10 de la mañana",
  ];

  const history: HistoryEntry[] = [];

  for (const texto of guion) {
    history.push({ direction: "in", content: texto });
    await prisma.message.create({
      data: { conversationId: conversation.id, direction: "in", content: texto, answered: true },
    });
    console.log(`\n👤 ${texto}`);

    const respuesta = await runAgent({ business, customer, history });
    history.push({ direction: "out", content: respuesta });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "out",
        content: respuesta,
        answered: true,
      },
    });
    console.log(`🤖 ${respuesta}`);
  }

  const citas = await prisma.appointment.count({ where: { customerId: customer.id } });
  const leads = await prisma.lead.count({ where: { customerId: customer.id } });
  console.log(`\n✅ Demo lista: ${history.length} mensajes · ${citas} cita(s) · ${leads} lead(s)`);
}

main()
  .catch((e) => {
    console.error("Explotó:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
