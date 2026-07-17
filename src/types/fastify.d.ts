import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Body crudo tal como llegó, guardado por el content-type parser de server.ts.
     * Imprescindible para verificar la firma HMAC de Meta: si se reserializa el JSON,
     * los bytes cambian y la firma deja de coincidir.
     */
    rawBody?: Buffer;
  }
}
