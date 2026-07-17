import { defineConfig } from "vitest/config";

/**
 * `config/env.ts` valida el entorno al importarse y mata el proceso si falta algo.
 * Los tests de firma y parseo lo importan de forma indirecta, así que aquí le damos
 * valores de relleno ANTES de que cargue cualquier módulo.
 *
 * Ojo: WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN son los que usan los tests para
 * firmar y verificar; si cambias uno, cambia también el test.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      GROQ_API_KEY: "gsk_test_key_para_pruebas",
      WHATSAPP_VERIFY_TOKEN: "token-de-verificacion-de-prueba",
      WHATSAPP_APP_SECRET: "secreto-de-app-de-prueba",
      ADMIN_TOKEN: "clave-admin-de-prueba",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    },
  },
});
