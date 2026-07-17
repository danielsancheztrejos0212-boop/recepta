import { z } from "zod";

/**
 * Validación de variables de entorno con Zod.
 * Si algo falta o está mal, el proceso termina de inmediato (fail-fast)
 * con un mensaje en español que dice exactamente qué variable arreglar.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "es obligatoria (cadena de conexión de Postgres de Neon)")
    .refine((v) => /^postgres(ql)?:\/\//.test(v), {
      message: "debe ser una URL de Postgres (empieza por postgresql://)",
    }),
  GROQ_API_KEY: z.string().min(1, "es obligatoria (API key de Groq)"),
  GROQ_MODEL: z.string().min(1).default("llama-3.3-70b-versatile"),
  WHATSAPP_VERIFY_TOKEN: z
    .string()
    .min(1, "es obligatoria (token que inventas tú para verificar el webhook en Meta)"),
  WHATSAPP_APP_SECRET: z
    .string()
    .min(1, "es obligatoria (App Secret de tu app de Meta, para la firma HMAC)"),
  GRAPH_API_VERSION: z.string().min(1).default("v23.0"),
  ADMIN_TOKEN: z
    .string()
    .min(12, "debe tener al menos 12 caracteres (es la clave de tu panel admin)"),
  PORT: z.coerce.number().int().positive().default(3000),
  RESPONSE_DELAY_MS: z.coerce.number().int().min(0).default(10000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errores = parsed.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("\n");

    // No usamos el logger aquí: si el env está roto, queremos el mensaje más simple posible.
    console.error(
      [
        "",
        "❌ No pude arrancar: hay variables de entorno inválidas o faltantes.",
        "",
        errores,
        "",
        "👉 Copia .env.example a .env y complétalo. Cada variable está explicada ahí.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
