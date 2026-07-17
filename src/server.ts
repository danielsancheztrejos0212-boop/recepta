import path from "node:path";
import Fastify, { type FastifyError } from "fastify";
import fastifyStatic from "@fastify/static";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { webhookRoutes } from "./routes/webhook";
import { adminRoutes } from "./routes/admin";
import { cancelAllReplies } from "./conversation/debounce";

export function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    // Render y ngrok van detrás de proxy: sin esto, la IP del cliente sería la del proxy.
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB: los webhooks de Meta son pequeños
  });

  /**
   * Parser de JSON que CONSERVA el body crudo.
   * La firma HMAC de Meta se calcula sobre los bytes exactos que llegaron; si dejamos
   * que Fastify parsee el JSON y luego lo reserializamos, la firma nunca coincide.
   */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      request.rawBody = body;

      if (body.length === 0) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch {
        // JSON inválido: no es un 500, es un 400.
        const err = Object.assign(new Error("JSON inválido"), { statusCode: 400 });
        done(err, undefined);
      }
    },
  );

  // Panel admin estático en /admin/ (el HTML pide la clave y llama a /admin/api/*).
  app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/admin/",
    index: ["index.html"],
  });

  app.register(webhookRoutes);
  app.register(adminRoutes);

  /** Health check: lo usan Render y UptimeRobot para mantener la instancia despierta. */
  app.get("/health", async () => ({ ok: true }));

  app.get("/", async (_request, reply) => reply.redirect("/admin/"));

  /** Nada de stack traces hacia afuera: se loguea completo y se responde genérico. */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;

    if (status >= 500) {
      logger.error({ err: error, url: request.url }, "Error no controlado en una ruta");
      return reply.code(500).send({ error: "Error interno del servidor" });
    }

    return reply.code(status).send({ error: error.message });
  });

  return app;
}

async function main(): Promise<void> {
  const app = buildServer();

  const apagar = async (senal: string): Promise<void> => {
    logger.info({ senal }, "Apagando el servidor…");
    cancelAllReplies();
    await app.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => void apagar("SIGTERM"));
  process.on("SIGINT", () => void apagar("SIGINT"));

  // Una excepción suelta no puede matar al agente: se loguea y seguimos.
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "unhandledRejection capturado; el proceso sigue vivo");
  });

  try {
    await app.listen({ host: "0.0.0.0", port: env.PORT });
    logger.info(`Recepta escuchando en el puerto ${env.PORT} — panel en /admin/`);
  } catch (err) {
    logger.error({ err }, "No pude arrancar el servidor");
    process.exit(1);
  }
}

// Solo arranca si se ejecuta directamente (los tests importan buildServer sin levantar nada).
if (require.main === module) {
  void main();
}
