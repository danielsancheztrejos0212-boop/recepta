/* Recepta — panel admin. Vanilla JS, sin build ni frameworks. */
(() => {
  "use strict";

  const KEY = "recepta_token";
  const REFRESH_MS = 10_000;

  let token = sessionStorage.getItem(KEY) || "";
  let vistaActual = "conversaciones";
  let convAbierta = null;
  let refreshTimer = null;

  const $ = (id) => document.getElementById(id);

  // ── API ────────────────────────────────────────────────────────────────
  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      cerrarSesion();
      throw new Error("Sesión expirada. Vuelve a entrar.");
    }

    if (!res.ok) {
      let mensaje = `Error ${res.status}`;
      try {
        const cuerpo = await res.json();
        if (cuerpo.error) mensaje = cuerpo.error;
        if (Array.isArray(cuerpo.detalles) && cuerpo.detalles.length) {
          mensaje += ": " + cuerpo.detalles.map((d) => d.mensaje).join(", ");
        }
      } catch {
        /* respuesta sin JSON */
      }
      throw new Error(mensaje);
    }

    return res.status === 204 ? null : res.json();
  }

  function toast(mensaje, esError = false) {
    const el = $("toast");
    el.textContent = mensaje;
    el.className = esError ? "toast toast-error" : "toast";
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 3200);
  }

  // ── Login ──────────────────────────────────────────────────────────────
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("login-btn");
    const err = $("login-error");
    const intento = $("login-token").value.trim();

    if (!intento) return;

    btn.disabled = true;
    btn.textContent = "Entrando…";
    err.hidden = true;

    try {
      const res = await fetch("/admin/api/ping", {
        headers: { Authorization: `Bearer ${intento}` },
      });
      if (!res.ok) throw new Error("Clave incorrecta");

      token = intento;
      sessionStorage.setItem(KEY, token);
      await iniciar();
    } catch (e2) {
      err.textContent = e2.message === "Clave incorrecta" ? "Clave incorrecta." : "No pude validar la clave. ¿El servidor está arriba?";
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  });

  function cerrarSesion() {
    token = "";
    sessionStorage.removeItem(KEY);
    clearInterval(refreshTimer);
    $("app").hidden = true;
    $("login").hidden = false;
    $("login-token").value = "";
  }

  $("logout-btn").addEventListener("click", cerrarSesion);

  // ── Navegación ─────────────────────────────────────────────────────────
  $("tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;

    vistaActual = tab.dataset.view;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    document.querySelectorAll(".view").forEach((v) => {
      v.hidden = v.id !== `view-${vistaActual}`;
    });
    cargarVista();
  });

  $("business-filter").addEventListener("change", () => {
    convAbierta = null;
    $("chat-panel").hidden = true;
    $("chat-empty").hidden = false;
    cargarStats();
    cargarVista();
  });

  const filtroActual = () => $("business-filter").value;
  const qs = () => (filtroActual() ? `?businessId=${encodeURIComponent(filtroActual())}` : "");

  // ── Arranque ───────────────────────────────────────────────────────────
  async function iniciar() {
    $("login").hidden = true;
    $("app").hidden = false;

    await cargarSelectorConsultorios();
    await cargarStats();
    await cargarVista();

    clearInterval(refreshTimer);
    // Auto-refresh: solo tiene sentido en el visor de conversaciones (demo en vivo).
    refreshTimer = setInterval(() => {
      if (vistaActual === "conversaciones" && !document.hidden) {
        cargarConversaciones().catch(() => {});
        if (convAbierta) abrirConversacion(convAbierta, true).catch(() => {});
      }
    }, REFRESH_MS);
  }

  async function cargarSelectorConsultorios() {
    try {
      const negocios = await api("/admin/api/businesses");
      const sel = $("business-filter");
      const previo = sel.value;

      sel.innerHTML = '<option value="">Todos los consultorios</option>';
      negocios.forEach((n) => {
        const opt = document.createElement("option");
        opt.value = n.id;
        opt.textContent = n.name;
        sel.appendChild(opt);
      });
      sel.value = previo;
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function cargarStats() {
    try {
      const s = await api(`/admin/api/stats${qs()}`);
      $("stat-businesses").textContent = s.businesses;
      $("stat-conversations").textContent = s.conversations;
      $("stat-appointments").textContent = s.appointments;
      $("stat-leads").textContent = s.leads;
    } catch {
      /* los chips no son críticos */
    }
  }

  function cargarVista() {
    switch (vistaActual) {
      case "conversaciones": return cargarConversaciones();
      case "citas": return cargarCitas();
      case "leads": return cargarLeads();
      case "consultorios": return cargarConsultorios();
    }
  }

  const fecha = (iso) =>
    new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

  function filaVacia(tbody, colspan, texto) {
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.className = "empty";
    td.textContent = texto;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  /** Celda de texto. Siempre textContent: el contenido viene de WhatsApp, nunca confiar. */
  function celda(texto, className) {
    const td = document.createElement("td");
    td.textContent = texto ?? "—";
    if (className) td.className = className;
    return td;
  }

  // ── Conversaciones ─────────────────────────────────────────────────────
  async function cargarConversaciones() {
    const lista = $("conv-list");
    try {
      const convs = await api(`/admin/api/conversations${qs()}`);

      lista.innerHTML = "";
      if (convs.length === 0) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "Todavía no hay conversaciones.";
        lista.appendChild(li);
        return;
      }

      convs.forEach((c) => {
        const li = document.createElement("li");
        li.className = "conv-item" + (c.id === convAbierta ? " is-active" : "");
        li.tabIndex = 0;

        const nombre = document.createElement("strong");
        nombre.textContent = c.customer.name || c.customer.waPhone;

        const preview = document.createElement("span");
        preview.className = "conv-preview";
        preview.textContent = c.lastMessage
          ? (c.lastMessage.direction === "out" ? "Agente: " : "") + c.lastMessage.content
          : "(sin mensajes)";

        const meta = document.createElement("span");
        meta.className = "conv-meta";
        meta.textContent = `${c.business.name} · ${fecha(c.updatedAt)}`;

        li.append(nombre, preview, meta);
        li.addEventListener("click", () => abrirConversacion(c.id));
        lista.appendChild(li);
      });
    } catch (e) {
      lista.innerHTML = "";
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = e.message;
      lista.appendChild(li);
    }
  }

  async function abrirConversacion(id, esRefresh = false) {
    try {
      const c = await api(`/admin/api/conversations/${id}`);
      convAbierta = id;

      $("chat-empty").hidden = true;
      $("chat-panel").hidden = false;
      $("chat-name").textContent = c.customer.name || "Paciente";
      $("chat-phone").textContent = c.customer.waPhone;
      $("chat-business").textContent = c.business.name;

      const cont = $("chat-bubbles");
      const pegadoAbajo = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 60;
      cont.innerHTML = "";

      c.messages.forEach((m) => {
        const div = document.createElement("div");
        div.className = `bubble ${m.direction === "out" ? "bubble-out" : "bubble-in"}`;
        // textContent: un paciente podría mandar HTML por WhatsApp.
        div.textContent = m.content;

        const t = document.createElement("span");
        t.className = "bubble-time";
        t.textContent = hora(m.createdAt);
        div.appendChild(t);

        cont.appendChild(div);
      });

      // En refresh solo bajamos si el admin ya estaba mirando el final.
      if (!esRefresh || pegadoAbajo) cont.scrollTop = cont.scrollHeight;

      document.querySelectorAll(".conv-item").forEach((el) => el.classList.remove("is-active"));
      if (!esRefresh) cargarConversaciones();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ── Citas ──────────────────────────────────────────────────────────────
  const ESTADOS = ["pendiente", "confirmada", "cancelada", "atendida"];

  async function cargarCitas() {
    const tbody = $("citas-body");
    try {
      const citas = await api(`/admin/api/appointments${qs()}`);
      if (citas.length === 0) return filaVacia(tbody, 6, "Todavía no hay citas agendadas.");

      tbody.innerHTML = "";
      citas.forEach((c) => {
        const tr = document.createElement("tr");
        tr.append(
          celda(c.customer.name || c.customer.waPhone),
          celda(c.serviceName),
          celda(c.date),
          celda(c.time),
          celda(c.business.name),
        );

        const tdEstado = document.createElement("td");
        const sel = document.createElement("select");
        ESTADOS.forEach((e) => {
          const opt = document.createElement("option");
          opt.value = e;
          opt.textContent = e;
          opt.selected = e === c.status;
          sel.appendChild(opt);
        });

        sel.addEventListener("change", async () => {
          const previo = c.status;
          sel.disabled = true;
          try {
            await api(`/admin/api/appointments/${c.id}`, {
              method: "PATCH",
              body: JSON.stringify({ status: sel.value }),
            });
            c.status = sel.value;
            toast("Estado actualizado");
          } catch (e) {
            sel.value = previo;
            toast(e.message, true);
          } finally {
            sel.disabled = false;
          }
        });

        tdEstado.appendChild(sel);
        tr.appendChild(tdEstado);
        tbody.appendChild(tr);
      });
    } catch (e) {
      filaVacia(tbody, 6, e.message);
    }
  }

  // ── Leads ──────────────────────────────────────────────────────────────
  async function cargarLeads() {
    const tbody = $("leads-body");
    try {
      const leads = await api(`/admin/api/leads${qs()}`);
      if (leads.length === 0) return filaVacia(tbody, 6, "Todavía no hay leads.");

      tbody.innerHTML = "";
      leads.forEach((l) => {
        const tr = document.createElement("tr");
        tr.append(
          celda(l.customer.name || l.customer.waPhone),
          celda(l.need),
          celda(l.contactInfo),
          celda(l.business.name),
        );

        const tdBadge = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = l.qualified ? "badge" : "badge badge-off";
        badge.textContent = l.qualified ? "Calificado" : "Solo preguntaba";
        tdBadge.appendChild(badge);

        tr.append(tdBadge, celda(fecha(l.createdAt)));
        tbody.appendChild(tr);
      });
    } catch (e) {
      filaVacia(tbody, 6, e.message);
    }
  }

  // ── Consultorios ───────────────────────────────────────────────────────
  let negociosCache = [];

  async function cargarConsultorios() {
    const tbody = $("businesses-body");
    try {
      negociosCache = await api("/admin/api/businesses");
      if (negociosCache.length === 0) {
        return filaVacia(tbody, 6, "Todavía no hay consultorios. Crea el primero →");
      }

      tbody.innerHTML = "";
      negociosCache.forEach((n) => {
        const tr = document.createElement("tr");
        tr.append(celda(n.name), celda(n.type), celda(n.wabaPhoneNumberId));

        const tdAviso = document.createElement("td");
        const bAviso = document.createElement("span");
        bAviso.className = n.ownerPhone ? "badge" : "badge badge-warn";
        bAviso.textContent = n.ownerPhone ? n.ownerPhone : "sin configurar";
        tdAviso.appendChild(bAviso);

        const tdActivo = document.createElement("td");
        const bActivo = document.createElement("span");
        bActivo.className = n.active ? "badge" : "badge badge-off";
        bActivo.textContent = n.active ? "Activo" : "Inactivo";
        tdActivo.appendChild(bActivo);

        const tdAcc = document.createElement("td");
        const btn = document.createElement("button");
        btn.className = "btn-icon";
        btn.textContent = "Editar";
        btn.addEventListener("click", () => abrirFormulario(n));
        tdAcc.appendChild(btn);

        tr.append(tdAviso, tdActivo, tdAcc);
        tbody.appendChild(tr);
      });
    } catch (e) {
      filaVacia(tbody, 6, e.message);
    }
  }

  // Filas dinámicas de servicios
  function filaServicio(s = {}) {
    const div = document.createElement("div");
    div.className = "row";

    const nombre = document.createElement("input");
    nombre.placeholder = "Limpieza facial";
    nombre.value = s.nombre || "";
    nombre.dataset.f = "nombre";

    const precio = document.createElement("input");
    precio.placeholder = "120.000 COP";
    precio.value = s.precio || "";
    precio.dataset.f = "precio";

    const duracion = document.createElement("input");
    duracion.placeholder = "45 min";
    duracion.value = s.duracion || "";
    duracion.dataset.f = "duracion";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "row-del";
    del.textContent = "×";
    del.title = "Quitar servicio";
    del.addEventListener("click", () => div.remove());

    div.append(nombre, precio, duracion, del);
    return div;
  }

  function filaPregunta(valor = "") {
    const div = document.createElement("div");
    div.className = "row-single";

    const input = document.createElement("input");
    input.placeholder = "nombre completo";
    input.value = valor;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "row-del";
    del.textContent = "×";
    del.title = "Quitar dato";
    del.addEventListener("click", () => div.remove());

    div.append(input, del);
    return div;
  }

  $("add-servicio").addEventListener("click", () => $("servicios-rows").appendChild(filaServicio()));
  $("add-pregunta").addEventListener("click", () => $("preguntas-rows").appendChild(filaPregunta()));

  $("new-business-btn").addEventListener("click", () => abrirFormulario(null));
  $("cancel-form-btn").addEventListener("click", () => ($("business-form-card").hidden = true));

  function abrirFormulario(negocio) {
    const esNuevo = !negocio;
    const cfg = (negocio && negocio.systemPromptConfig) || {};

    $("business-form-card").hidden = false;
    $("form-title").textContent = esNuevo ? "Nuevo consultorio" : `Editar: ${negocio.name}`;
    $("form-error").hidden = true;

    $("f-id").value = esNuevo ? "" : negocio.id;
    $("f-name").value = esNuevo ? "" : negocio.name;
    $("f-type").value = esNuevo ? "" : negocio.type;
    $("f-phoneid").value = esNuevo ? "" : negocio.wabaPhoneNumberId;
    $("f-ownerphone").value = esNuevo ? "" : negocio.ownerPhone || "";
    $("f-timezone").value = esNuevo ? "America/Bogota" : negocio.timezone;
    $("f-active").checked = esNuevo ? true : negocio.active;

    // El token nunca vuelve del servidor: al editar queda vacío y solo se cambia si escribes uno.
    $("f-token").value = "";
    $("f-token").required = esNuevo;
    $("f-token-help").textContent = esNuevo
      ? "Token permanente del usuario de sistema."
      : "Déjalo vacío para conservar el token actual.";

    $("f-direccion").value = cfg.direccion || "";
    $("f-horario").value = cfg.horario || "";
    $("f-personalidad").value = cfg.personalidad || "";
    $("f-infoadicional").value = cfg.infoAdicional || "";

    const servicios = $("servicios-rows");
    servicios.innerHTML = "";
    (cfg.servicios && cfg.servicios.length ? cfg.servicios : [{}]).forEach((s) =>
      servicios.appendChild(filaServicio(s)),
    );

    const preguntas = $("preguntas-rows");
    preguntas.innerHTML = "";
    const pregs =
      cfg.preguntasCita && cfg.preguntasCita.length
        ? cfg.preguntasCita
        : ["nombre completo", "servicio deseado", "fecha y hora preferida"];
    pregs.forEach((p) => preguntas.appendChild(filaPregunta(p)));

    $("business-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("business-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = $("f-id").value;
    const esNuevo = !id;
    const btn = $("save-btn");
    const err = $("form-error");

    const servicios = [...$("servicios-rows").querySelectorAll(".row")]
      .map((row) => ({
        nombre: row.querySelector('[data-f="nombre"]').value.trim(),
        precio: row.querySelector('[data-f="precio"]').value.trim(),
        duracion: row.querySelector('[data-f="duracion"]').value.trim(),
      }))
      .filter((s) => s.nombre);

    const preguntasCita = [...$("preguntas-rows").querySelectorAll("input")]
      .map((i) => i.value.trim())
      .filter(Boolean);

    const body = {
      name: $("f-name").value.trim(),
      type: $("f-type").value.trim(),
      wabaPhoneNumberId: $("f-phoneid").value.trim(),
      ownerPhone: $("f-ownerphone").value.trim(),
      timezone: $("f-timezone").value.trim() || "America/Bogota",
      active: $("f-active").checked,
      systemPromptConfig: {
        tipo: $("f-type").value.trim(),
        direccion: $("f-direccion").value.trim(),
        horario: $("f-horario").value.trim(),
        personalidad: $("f-personalidad").value.trim(),
        infoAdicional: $("f-infoadicional").value.trim(),
        servicios,
        preguntasCita,
      },
    };

    const tokenNuevo = $("f-token").value.trim();
    if (esNuevo || tokenNuevo) body.accessToken = tokenNuevo;

    btn.disabled = true;
    btn.textContent = "Guardando…";
    err.hidden = true;

    try {
      await api(esNuevo ? "/admin/api/businesses" : `/admin/api/businesses/${id}`, {
        method: esNuevo ? "POST" : "PUT",
        body: JSON.stringify(body),
      });

      toast(esNuevo ? "Consultorio creado" : "Consultorio actualizado");
      $("business-form-card").hidden = true;
      await cargarSelectorConsultorios();
      await cargarStats();
      await cargarConsultorios();
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar consultorio";
    }
  });

  // Si ya había sesión en esta pestaña, entramos directo.
  if (token) {
    fetch("/admin/api/ping", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? iniciar() : cerrarSesion()))
      .catch(() => cerrarSesion());
  }
})();
