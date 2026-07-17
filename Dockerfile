# Recepta — imagen de producción (Render free)
FROM node:20-slim

# Prisma necesita openssl en las imágenes slim; sin esto, el cliente no arranca.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Primero las dependencias: si no cambian, Docker reutiliza esta capa y el build vuela.
COPY package.json package-lock.json ./
RUN npm ci

# El cliente de Prisma se genera desde el schema, así que este va antes del build.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# El panel es estático: se sirve tal cual desde public/.
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

# Las migraciones corren en cada arranque: en Render no hay un paso de deploy aparte.
# `migrate deploy` es idempotente — si no hay nada nuevo, no hace nada.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
