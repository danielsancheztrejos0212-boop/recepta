# ▶️ SIGUIENTE — retomar aquí

Estado al 17 de julio de 2026. Lo que ya funciona y los **3 pasos manuales** que faltan
(todos requieren tu login, por eso no los pude hacer yo).

---

## ✅ Lo que YA funciona (probado de verdad)

| Pieza | Estado |
|---|---|
| App desplegada en Render | ✅ https://recepta-jcpo.onrender.com |
| Panel admin | ✅ https://recepta-jcpo.onrender.com/admin/ |
| Base de datos (Neon) | ✅ conectada, migraciones aplicadas |
| IA (Groq) | ✅ responde en español |
| WhatsApp — recibir mensajes | ✅ webhook verificado y suscrito a `messages` |
| WhatsApp — enviar respuestas | ✅ probado, llega al teléfono |
| Agenda citas + capta leads | ✅ el agente lo hace solo |
| Aviso de cita al dueño | ✅ configurado a tu WhatsApp |
| Retraso de respuesta | ✅ 5 segundos (medido) |

**Consultorio de prueba activo:** "Clínica Bella Piel" (datos de demo; edítalo o crea el tuyo en el panel).

### Datos de referencia (NO son secretos)
- **App ID (Meta):** `1050193794211418`
- **WABA ID:** `1491844809296055`
- **Phone Number ID:** `1187617167775959`
- **Número de prueba del bot:** +1 555 180 3985

> Los secretos (token de Meta, App Secret, DATABASE_URL, GROQ_API_KEY, ADMIN_TOKEN) están
> en Render (variables de entorno) y en tu `.env` local. NUNCA en el repo.

---

## ⏳ Los 3 pasos que faltan (tu login, ~10 min en total)

### 1. UptimeRobot — para que Render no se duerma (5 min) ⭐ el más importante
**Problema real:** Render (plan gratis) se duerme a los 15 min sin tráfico. Por eso tu
*primer* mensaje de prueba no respondió: Render estaba dormido cuando Meta intentó entregar.

**Solución:**
1. Entra a https://uptimerobot.com y regístrate (gratis).
2. **Add New Monitor**.
3. Tipo: **HTTP(s)**.
4. Nombre: `Recepta`.
5. URL: `https://recepta-jcpo.onrender.com/health`
6. Intervalo: **5 minutos**.
7. **Create Monitor**.

Listo: le pega cada 5 min y nunca se duerme. Sin esto, cada rato de inactividad hace
que el primer paciente que escriba se pierda.

### 2. Token permanente de Meta — para que no se caiga (5 min)
**Problema:** el token actual es temporal (Meta los da por ~24 h). Cuando expire, el bot
deja de poder responder.

**Solución (en business.facebook.com):**
1. **Configuración del negocio** → **Usuarios** → **Usuarios del sistema** → **Agregar**.
2. Nombre: `recepta-bot` · Rol: **Administrador** → crear.
3. **Agregar activos** → **Apps** → elige **Recepta** → activa **Control total**.
4. **Generar nuevo token** → app **Recepta** → caducidad: **Nunca** → marca los **tres** permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
   - `business_management`
5. **Generar** y **copia** el token (empieza por `EAA...`, solo se muestra una vez).
6. Ponlo en el bot **sin ayuda de nadie**: entra al panel
   https://recepta-jcpo.onrender.com/admin/ → pestaña **Consultorios** → **Editar** en
   "Clínica Bella Piel" → pega el token en **"Token de acceso"** → **Guardar**.
   (El campo aparece vacío a propósito; si lo dejas vacío conserva el anterior.)

### 3. Cambiar la clave del panel — seguridad (2 min)
**Problema:** la clave actual (`recepta-local-2026`) es débil y el panel es público con
datos de pacientes (Ley 1581 de habeas data).

**Solución:**
1. Genera una clave fuerte (en tu compu: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
2. En **Render** → servicio `recepta` → **Environment** → variable `ADMIN_TOKEN` → pon la
   nueva → **Save** (reinicia solo).
3. Usa la nueva clave para entrar al panel.

---

## 🧪 Cómo probar que todo sigue bien (cuando vuelvas)
1. Escríbele al bot desde tu WhatsApp: *"hola, ¿cuánto vale la limpieza facial?"*
2. Espera ~7-8 s → te responde con IA.
3. Prueba agendar: *"quiero una cita mañana a las 3, me llamo Daniel"* → te llega la
   confirmación **y** el aviso de cita nueva.
4. Míralo en vivo en el panel → **Conversaciones**.

## ⚠️ Recordatorio de seguridad
Rota estas credenciales que quedaron en el chat de esta sesión:
- **Groq API key** → https://console.groq.com/keys (y actualízala en Render + `.env`).
- Cuando hagas el token permanente, el temporal muere solo (no hay que revocarlo).
