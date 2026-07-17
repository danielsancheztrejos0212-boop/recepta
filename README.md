# Recepta 🩺

**Recepcionista de IA para consultorios de salud, por WhatsApp.**

Un agente atiende a tus pacientes por WhatsApp 24/7: responde dudas con la información que tú cargas, capta interesados y agenda citas conversando normal. Tú manejas todo desde un panel web privado.

- Los pacientes **solo usan WhatsApp**. Nunca ven esta app.
- Tú eres el **único administrador**. Gestionas varios consultorios desde el mismo panel.
- **Todo el stack corre en planes gratuitos** (Groq + Neon + Render).

---

## Índice

1. [Cómo funciona](#1-cómo-funciona)
2. [Qué necesitas antes de empezar](#2-qué-necesitas-antes-de-empezar)
3. [Crear las cuentas gratis](#3-crear-las-cuentas-gratis)
4. [Configurar WhatsApp en Meta](#4-configurar-whatsapp-en-meta)
5. [Probar en tu computador](#5-probar-en-tu-computador)
6. [Publicar en internet (Render)](#6-publicar-en-internet-render)
7. [Conectar el webhook de Meta](#7-conectar-el-webhook-de-meta)
8. [Que no se duerma (UptimeRobot)](#8-que-no-se-duerma-uptimerobot)
9. [Dar de alta tu primer consultorio](#9-dar-de-alta-tu-primer-consultorio)
10. [El aviso al dueño y su limitación](#10-el-aviso-al-dueño-y-su-limitación-importante)
11. [Límites reales del plan gratis](#11-límites-reales-del-plan-gratis)
12. [Cumplimiento legal](#12-cumplimiento-legal)
13. [Problemas comunes](#13-problemas-comunes)
14. [Para desarrolladores](#14-para-desarrolladores)

---

## 1. Cómo funciona

```
Paciente escribe por WhatsApp
        ↓
Meta le avisa a tu servidor (webhook)
        ↓
El servidor verifica que el mensaje sea de verdad de Meta (firma)
        ↓
Marca "leído" y muestra "escribiendo…"      ← efecto humano
        ↓
Espera ~10 segundos                          ← si el paciente sigue escribiendo, vuelve a esperar
        ↓
La IA (Groq) lee la conversación y la info de tu consultorio
        ↓
Responde · agenda la cita · o guarda al interesado
        ↓
Si agendó una cita → te llega un aviso a tu WhatsApp personal
```

Lo importante: si el paciente manda **"Hola" · "buenas" · "quería preguntar algo"** en tres mensajes seguidos, el agente **no** responde tres veces. Espera a que termine y contesta una sola vez, como una persona.

---

## 2. Qué necesitas antes de empezar

- Un computador con **Node.js 20 o superior** ([descárgalo aquí](https://nodejs.org)). Verifica con `node --version`.
- Una cuenta de **Facebook** (para Meta).
- Un **celular con WhatsApp** para hacer pruebas.
- ~1 hora la primera vez. No necesitas saber programar, pero sí seguir los pasos con calma.

> 💡 Todos los comandos de esta guía se escriben en la terminal, **dentro de la carpeta del proyecto**.

---

## 3. Crear las cuentas gratis

### 3.1 Groq (el cerebro de la IA) — gratis

1. Entra a [console.groq.com](https://console.groq.com) y regístrate.
2. Ve a **API Keys** → **Create API Key**.
3. Cópiala (empieza por `gsk_`). **Solo se muestra una vez.**

### 3.2 Neon (la base de datos) — gratis

1. Entra a [neon.tech](https://neon.tech) y regístrate.
2. **New Project** → ponle `recepta` → **Create**.
3. Copia la **Connection string**. Se ve así:
   `postgresql://usuario:clave@ep-algo-123.us-east-2.aws.neon.tech/neondb?sslmode=require`

### 3.3 Render (el servidor) — gratis

Regístrate en [render.com](https://render.com) con tu cuenta de GitHub. Lo configuras en el paso 6.

---

## 4. Configurar WhatsApp en Meta

Esta es la parte más larga. Hazla con paciencia.

### 4.1 Crear la app

1. Entra a [developers.facebook.com](https://developers.facebook.com) → **Mis apps** → **Crear app**.
2. Caso de uso: **Otro** → Tipo: **Negocio** → ponle nombre (`Recepta`) → **Crear app**.
3. En el panel, busca **WhatsApp** → **Configurar**.

### 4.2 Datos que vas a necesitar

En **WhatsApp → Configuración de la API** verás:

| Dato | Dónde está | Para qué sirve |
|---|---|---|
| **Identificador del número de teléfono** (`phone_number_id`) | En el desplegable "Número de teléfono de prueba" | Identifica al consultorio. Va en el panel. |
| **Token temporal** | Botón "Generar token de acceso" | Sirve para probar hoy. **Dura 24 horas.** |
| **App Secret** | Configuración → Básica → "Clave secreta de la aplicación" | Verifica que los webhooks son de Meta. Va en `.env`. |

### 4.3 Números de prueba (importante)

Meta te da un número de prueba gratis, pero **solo puede escribirle a 5 números que tú registres**.

En **Configuración de la API** → sección "Para" → **Administrar lista de números de teléfono** → agrega:
- Tu WhatsApp personal (para probar como paciente).
- El WhatsApp del dueño del consultorio (si quieres que reciba los avisos de cita).

Cada número recibe un código de verificación por WhatsApp.

### 4.4 Token permanente (para producción)

El token temporal muere en 24 h. Para que no se te caiga el bot cada día:

1. [business.facebook.com](https://business.facebook.com) → **Configuración del negocio**.
2. **Usuarios** → **Usuarios del sistema** → **Agregar** → nombre: `recepta-bot`, rol: **Administrador**.
3. **Agregar activos** → **Apps** → elige tu app → activa **Control total**.
4. **Generar nuevo token** → elige tu app → caducidad: **Nunca** → permisos:
   - ✅ `whatsapp_business_messaging`
   - ✅ `whatsapp_business_management`
5. **Genera** y guarda el token en un lugar seguro. **Solo se muestra una vez.**

Ese es el token que va en el campo "Token de acceso" del panel.

---

## 5. Probar en tu computador

### 5.1 Instalar

```bash
npm install
npx prisma generate
```

### 5.2 Configurar

```bash
# Windows
copy .env.example .env
# Mac / Linux
cp .env.example .env
```

Abre `.env` y llena cada valor. El archivo está comentado variable por variable.

Para el `ADMIN_TOKEN` (tu clave del panel), genera una segura:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

### 5.3 Crear las tablas

```bash
npx prisma migrate dev --name init
```

### 5.4 Arrancar

```bash
npm run dev
```

Abre **http://localhost:3000/admin/** y entra con tu `ADMIN_TOKEN`. Ya deberías ver el panel.

### 5.5 Exponerlo a internet con ngrok (para probar WhatsApp de verdad)

Meta necesita alcanzar tu computador desde internet.

1. Instala [ngrok](https://ngrok.com/download) y regístrate (gratis).
2. En **otra terminal**, con `npm run dev` corriendo:

```bash
ngrok http 3000
```

3. Copia la URL que te da (`https://algo-random.ngrok-free.app`). Esa es tu URL pública temporal.

> ⚠️ La URL de ngrok **cambia cada vez que lo reinicias**, y toca actualizar el webhook en Meta. Por eso, para uso real, mejor Render (paso 6).

---

## 6. Publicar en internet (Render)

1. Sube el proyecto a un repo de **GitHub**.
2. En Render: **New** → **Blueprint** → elige tu repo.
3. Render lee el archivo `render.yaml` y arma el servicio solo.
4. Te va a pedir los secretos. Pega los mismos de tu `.env`:
   - `DATABASE_URL` (Neon)
   - `GROQ_API_KEY`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_APP_SECRET`
   - `ADMIN_TOKEN`
5. **Apply**. El primer deploy tarda unos minutos.

Cuando termine tendrás una URL fija: `https://recepta.onrender.com`. Tu panel queda en `https://recepta.onrender.com/admin/`.

> No configures `PORT` en Render: la plataforma lo asigna sola.
> Las migraciones de base de datos corren solas en cada arranque.

---

## 7. Conectar el webhook de Meta

En **Meta → tu app → WhatsApp → Configuración** → sección **Webhook** → **Editar**:

| Campo | Qué poner |
|---|---|
| **URL de devolución de llamada** | `https://recepta.onrender.com/webhook/whatsapp` |
| **Token de verificar** | Exactamente el mismo `WHATSAPP_VERIFY_TOKEN` de tu `.env` |

**Verificar y guardar.** Si da error, revisa que el servidor esté arriba y que el token sea idéntico (sin espacios de más).

Después, en **Campos del webhook** → busca `messages` → **Suscribirse**. ⚠️ **Sin este paso no llega ningún mensaje.**

---

## 8. Que no se duerma (UptimeRobot)

El plan free de Render **duerme el servidor tras 15 minutos sin tráfico**, y despertarlo tarda ~50 segundos. Un paciente no espera eso.

Solución gratis:

1. Regístrate en [uptimerobot.com](https://uptimerobot.com).
2. **Add New Monitor**:
   - Tipo: **HTTP(s)**
   - Nombre: `Recepta`
   - URL: `https://recepta.onrender.com/health`
   - Intervalo: **5 minutos**
3. **Create Monitor**.

Listo: lo golpea cada 5 minutos y nunca se duerme.

---

## 9. Dar de alta tu primer consultorio

Entra a tu panel → pestaña **Consultorios** → **+ Nuevo consultorio**:

| Campo | Ejemplo | Nota |
|---|---|---|
| Nombre | Clínica Bella Piel | Como lo llama el agente |
| Tipo | clínica estética | Define el tono |
| Phone number ID | `106540352242922` | De Meta (paso 4.2) |
| Token de acceso | `EAAG...` | El permanente (paso 4.4) |
| WhatsApp del dueño | `573001112233` | Sin `+`, sin espacios. Opcional |
| Zona horaria | `America/Bogota` | Para interpretar "mañana a las 3" |
| Dirección, horario, personalidad | | Lo que el agente puede decir |
| **Servicios** | Limpieza facial · 120.000 COP · 45 min | **El agente no puede ofrecer nada fuera de esta lista** |
| Datos antes de agendar | nombre completo, servicio, fecha y hora | Lo que reúne antes de la cita |

**Guardar**, y ya. Escríbele por WhatsApp al número de prueba desde tu celular y mira la pestaña **Conversaciones**: el chat aparece solo, se refresca cada 10 segundos.

> 💡 Entre más completos los servicios y el horario, mejor responde. Si algo no está cargado, el agente **no lo inventa**: lo dice y guarda al interesado como lead.

---

## 10. El aviso al dueño y su limitación (importante)

Cada vez que el agente agenda una cita, el dueño recibe esto en su WhatsApp personal:

```
🗓️ Nueva cita — Clínica Bella Piel
👤 Paciente: María Gómez
📅 Fecha: 2026-07-20 a las 15:30
📝 Motivo: Limpieza facial
```

### La limitación

WhatsApp tiene la **regla de las 24 horas**: un negocio solo puede mandar texto libre a alguien que le haya escrito en las últimas 24 h. Este aviso lo **inicia el negocio**, así que le aplica la regla.

**En cristiano:** si el dueño no le ha escrito nada al número del bot en las últimas 24 horas, el aviso **no le llega**. La cita sí queda guardada y visible en el panel — solo se pierde la notificación.

### Cómo convivir con eso hoy (gratis)

- **Lo más fácil:** que el dueño le mande un "hola" al número del bot **cada mañana**. Con eso, la ventana queda abierta las siguientes 24 h.
- Que se **fije el chat** arriba en su WhatsApp para no olvidarlo.
- Con el **número de prueba** de Meta hay un requisito extra: el WhatsApp del dueño tiene que estar entre los **5 destinatarios registrados** (paso 4.3).

### La solución definitiva

Una **plantilla de utilidad aprobada** por Meta se entrega siempre, sin depender de la ventana de 24 h. Cuesta centavos por mensaje. Está en la Fase 2 (ver abajo).

Mientras tanto, el sistema es honesto: si el aviso falla, queda un warning en los logs y **la conversación con el paciente nunca se ve afectada**.

---

## 11. Límites reales del plan gratis

| Servicio | Límite | Qué significa en la práctica |
|---|---|---|
| **Groq** | ~1.000 respuestas/día (14.400 req/día) | Suficiente para varios consultorios pequeños |
| **Neon** | 0.5 GB | Cientos de miles de mensajes |
| **Render** | 750 h/mes · duerme a los 15 min | Con UptimeRobot alcanza para 1 servicio 24/7 |
| **Meta WhatsApp** | 1.000 conversaciones/mes gratis | Se cuenta por conversación de 24 h, no por mensaje |
| **Meta (número de prueba)** | Solo 5 destinatarios | Para producción, registra un número propio |

Cuando se te quede corto, lo primero que toca pagar es Render (~$7/mes por que no duerma).

---

## 12. Cumplimiento legal

Esta app maneja **datos personales de pacientes** y conversa en un contexto de **salud**. Tenlo presente:

- **Ley 1581 (habeas data, Colombia).** Guardas nombre, teléfono y motivo de consulta. Necesitas base legal, informar para qué los usas, y poder borrarlos si te lo piden.
- **El agente NO da diagnósticos.** Está instruido para ofrecer una valoración y nunca opinar sobre síntomas.
- **El agente NO pide datos sensibles:** ni historia clínica, ni documentos, ni datos de pago.
- **El agente admite que es un asistente virtual** si le preguntan. No lo cambies: en varias jurisdicciones ocultarlo es ilegal.
- **Solo se responde a quien escribe primero** (ventana de servicio de 24 h). Aquí **no hay envíos masivos ni plantillas de marketing**, a propósito.
- En los logs, los teléfonos van enmascarados y los tokens nunca se imprimen.

---

## 13. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| "No pude arrancar: variables inválidas" | Falta algo en `.env` | El mensaje dice la variable exacta. Revísala. |
| Meta no verifica el webhook | Token distinto, o servidor caído | Que `WHATSAPP_VERIFY_TOKEN` sea idéntico. Prueba `/health`. |
| El webhook verifica pero no llegan mensajes | No te suscribiste al campo `messages` | Meta → Webhook → Campos → `messages` → Suscribirse |
| El agente no responde | Token del consultorio vencido | El temporal dura 24 h. Usa el permanente (paso 4.4). |
| "Consultorio inactivo" en los logs | El switch "Activo" está apagado | Actívalo en el panel. |
| Responde "dame un momentico" siempre | Groq caído o sin cuota | Mira los logs. Es el fallback de seguridad. |
| Al dueño no le llega el aviso | Ventana de 24 h cerrada | Ver [sección 10](#10-el-aviso-al-dueño-y-su-limitación-importante). |
| Primer mensaje del día tarda ~50 s | Render se durmió | Configura UptimeRobot (paso 8). |
| El panel dice "Clave incorrecta" | `ADMIN_TOKEN` distinto | Debe coincidir exactamente con el del `.env`. |

Para ver qué está pasando: en Render → tu servicio → **Logs**. En local, aparecen en la terminal de `npm run dev`.

---

## 14. Para desarrolladores

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor local con recarga automática |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Corre lo compilado (producción) |
| `npm test` | Tests (firma HMAC y parseo de webhooks) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate:dev` | Crea una migración nueva en desarrollo |
| `npm run db:migrate` | Aplica migraciones (producción) |
| `npx prisma studio` | Explorador visual de la base de datos |

### Stack

Node 20 · TypeScript 5 (strict) · Fastify 5 · Prisma 6 + PostgreSQL · Groq (`llama-3.3-70b-versatile`) · Zod · pino · vitest · panel en HTML/CSS/JS sin build.

### Decisiones de diseño

- **Debounce en memoria, no Redis.** Un `Map` de timers en el proceso. Asume **una sola instancia**, que es justo lo que da Render free. Si algún día escalas a varias, esto se mueve a Redis + BullMQ (`conversation/debounce.ts` es el único archivo que cambia).
- **Serialización por paciente (`lib/mutex.ts`).** El webhook responde 200 al instante y procesa en `setImmediate`, así que los mensajes de una ráfaga se procesan **en paralelo**. Sin candado, los tres hacían "busca la conversación abierta, si no existe créala" a la vez y creaban tres conversaciones: la ráfaga se partía, el agente perdía contexto y no lograba agendar. Todo el bloque upsert-paciente → busca/crea-conversación → guarda-mensaje va serializado por `businessId:teléfono`. Asume una sola instancia, igual que el debounce; multi-instancia pediría un índice único parcial en Postgres o un lock en Redis.
- **La idempotencia de las citas vive en la BD, no en el prompt.** El historial que recibe el agente son solo los mensajes de texto: **sus propias llamadas a tools no se persisten**, así que en el turno siguiente no recuerda que ya agendó. Ante un "sí, confirmo" volvía a llamar `agendar_cita` → cita duplicada y dos avisos al dueño. Por eso `agendar_cita` verifica primero si ya existe una cita viva del mismo paciente a la misma fecha y hora. Nunca confíes en que el modelo recuerde lo que hizo.
- **La salida del modelo se limpia antes de enviarla.** Llama a veces escribe la llamada a la tool como texto (`<function=guardar_lead>{...}</function>`) en vez de usar `tool_calls`. Sin `limpiarRespuesta()` en `conversation/agent.ts`, el paciente recibiría esa basura por WhatsApp.
- **Multi-tenant estricto.** Toda consulta filtra por `businessId`. Las tools amarran lo que escriben al negocio del contexto, nunca a un id que venga del modelo.
- **El `accessToken` es write-only.** Nunca sale por la API (`businessSelect` en `routes/admin.ts` lo excluye) ni por los logs (pino lo redacta). Al editar un consultorio, el campo aparece vacío: si lo dejas así, se conserva el que ya estaba.
- **Firma HMAC sobre el body crudo.** El content-type parser de `server.ts` guarda el `Buffer` original. Si se reserializara el JSON, los bytes cambiarían y la firma no validaría nunca. Hay un test que fija justo eso.
- **Nada tumba el proceso.** Groq, Meta o Postgres pueden fallar: el paciente ve un fallback amable y el error queda en el log.
- **Idempotencia por `waMessageId`.** Meta reintenta los webhooks; el índice único + captura del error P2002 hace la deduplicación.
- **Si el envío falla, los mensajes no se marcan como respondidos**, así el próximo mensaje del paciente reintenta en vez de dejar la ráfaga sin contestar.

### Estructura

```
src/
├── server.ts              # Fastify: rawBody, estáticos, rutas, /health
├── config/env.ts          # Validación Zod del entorno (fail-fast)
├── db/client.ts           # Singleton de Prisma
├── lib/logger.ts          # pino + maskPhone()
├── whatsapp/
│   ├── verify.ts          # Firma HMAC + challenge
│   ├── parse.ts           # Payload de Meta → IncomingMessage
│   └── send.ts            # sendText · markReadAndTyping · notifyOwner
├── tenants/resolve.ts     # phone_number_id → Business
├── conversation/
│   ├── debounce.ts        # Timers en memoria (efecto humano)
│   ├── respond.ts         # Junta ráfaga → agente → envía → persiste
│   ├── agent.ts           # Bucle de tool calling con Groq
│   ├── prompt.ts          # System prompt desde systemPromptConfig
│   └── tools.ts           # agendar_cita · guardar_lead
└── routes/
    ├── webhook.ts         # GET verificación · POST mensajes
    └── admin.ts           # API del panel (Bearer ADMIN_TOKEN)
```

### Fase 2 (ideas, no implementadas)

- Disponibilidad real de agenda: bloques por consultorio y detección de choques.
- Recordatorios de cita con plantillas aprobadas.
- **Plantilla de utilidad para el aviso al dueño** (quita la limitación de las 24 h).
- Redis + BullMQ para debounce multi-instancia.
- Métricas por consultorio (conversaciones/día, tasa de conversión a cita).
- Audios con transcripción (Whisper en Groq).

---

Hecho con 🩺 para consultorios que no quieren perder pacientes por no contestar a tiempo.
