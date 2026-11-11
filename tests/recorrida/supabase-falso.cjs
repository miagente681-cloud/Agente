/**
 * Supabase de mentira para probar sin un proyecto real: en las pruebas
 * unitarias (con el cliente real de supabase-js apuntando acá) y en la
 * recorrida en navegador. Guarda todo en memoria y entiende lo justo de
 * PostgREST que usa la app. No valida RLS: eso lo cubre tests/esquema.test.ts
 * contra un Postgres de verdad.
 */
const http = require("node:http");
const { randomUUID } = require("node:crypto");

const USUARIO = { id: "11111111-1111-1111-1111-111111111111", email: "prueba@ejemplo.com", aud: "authenticated", role: "authenticated" };
const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

/** JWT de mentira. La firma solo tiene que ser base64url válido. */
function jwtFalso() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: USUARIO.id, email: USUARIO.email, role: "authenticated", aud: "authenticated", exp }),
    Buffer.alloc(32, 7).toString("base64url"),
  ].join(".");
}

/** Cookie de sesión como la escribe @supabase/ssr. */
function cookieDeSesion() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sesion = { access_token: jwtFalso(), refresh_token: "falso", token_type: "bearer", expires_in: 3600, expires_at: exp, user: USUARIO };
  return { name: "sb-127-auth-token", value: "base64-" + b64(sesion) };
}

const TABLAS = [
  "profiles", "areas", "projects", "tasks", "call_routines", "availability_windows", "sessions",
  "messages", "project_log", "memories", "change_log", "push_subscriptions", "voice_usage", "llm_usage",
  "limites_frecuencia",
];

/** Una sesión de Supabase Auth como la devuelve el servidor real. */
function sesionFalsa() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: jwtFalso(), refresh_token: "falso", token_type: "bearer", expires_in: 3600, expires_at: exp, user: USUARIO };
}

function crearServidor() {
  const ahora = () => new Date().toISOString();
  // Contraseña de la cuenta de prueba: no tiene hasta que se pone en Configuración.
  let contrasena = null;
  // Para la recorrida: un endpoint que se fuerza a responder «límite alcanzado».
  const limitesForzados = new Set();
  let tablas;
  const reiniciar = () => {
    tablas = Object.fromEntries(TABLAS.map((t) => [t, []]));
    tablas.profiles.push({ user_id: USUARIO.id, name: "Prueba", timezone: "America/Montevideo", agent_config: {}, onboarding_done: true });
  };
  reiniciar();

  // Valores por defecto de cada tabla, como los de la migración.
  const DEFECTOS = {
    areas: () => ({ color: "#8b8b94", icon: null, sort_order: 0, archived_at: null }),
    projects: () => ({ area_id: null, goal: null, description: null, status: "activo", priority: 2, due_date: null, sort_order: 0 }),
    tasks: () => ({ parent_id: null, description: null, status: "pendiente", priority: 2, due_date: null, due_set_by: null, effort_minutes: null, blocked_reason: null, sort_order: 0, completed_at: null, archived_at: null, status_changed_at: ahora() }),
    call_routines: () => ({ weekdays: [], target_minutes: 10, focus: null, active: true }),
    sessions: () => ({ status: "en_curso", routine_id: null, rescheduled_from: null, scheduled_at: null, notified_at: null, started_at: null, ended_at: null, summary: null, commitments: [], reschedule_count: 0, providers_used: [], history_summary: null, history_summary_until: null, target_minutes: null, focus: null }),
    messages: () => ({ content: null, tool_calls: null, tool_result: null, provider: null, model: null, tokens_in: null, tokens_out: null }),
    project_log: () => ({ kind: "nota", author: "usuario", session_id: null }),
    memories: () => ({ source_session_id: null, edited_by_user: false, archived_at: null }),
    change_log: () => ({ session_id: null, message_id: null, old_values: null, new_values: null, undone_at: null }),
    llm_usage: () => ({ session_id: null, provider: "claude", input_tokens: 0, output_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, cache_read_tokens: 0, cost_usd: 0 }),
  };
  const completar = (tabla, fila) => {
    const base = { ...(tabla === "voice_usage" || tabla === "profiles" ? {} : { id: randomUUID() }), user_id: USUARIO.id, created_at: ahora(), updated_at: ahora() };
    return { ...base, ...DEFECTOS[tabla]?.(), ...fila };
  };

  const valor = (v) => (v === "null" ? null : v === "true" ? true : v === "false" ? false : v);
  const comparar = (a, b) => (typeof a === "number" ? a - Number(b) : String(a).localeCompare(String(b)));

  function condicion(columna, expr) {
    if (expr.startsWith("not.")) {
      const c = condicion(columna, expr.slice(4));
      return (f) => !c(f);
    }
    const i = expr.indexOf(".");
    const op = expr.slice(0, i);
    const arg = expr.slice(i + 1);
    switch (op) {
      case "is": return (f) => (arg === "null" ? f[columna] == null : f[columna] === valor(arg));
      case "eq": return (f) => String(f[columna]) === arg;
      case "neq": return (f) => String(f[columna]) !== arg;
      case "gt": return (f) => f[columna] != null && comparar(f[columna], arg) > 0;
      case "gte": return (f) => f[columna] != null && comparar(f[columna], arg) >= 0;
      case "lt": return (f) => f[columna] != null && comparar(f[columna], arg) < 0;
      case "lte": return (f) => f[columna] != null && comparar(f[columna], arg) <= 0;
      case "in": {
        const lista = arg.slice(1, -1).split(",").map((x) => x.replace(/^"|"$/g, ""));
        return (f) => lista.includes(String(f[columna]));
      }
      case "ilike": {
        const re = new RegExp("^" + arg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*") + "$", "i");
        return (f) => re.test(String(f[columna] ?? ""));
      }
      default: throw new Error(`Filtro no soportado: ${columna}=${expr}`);
    }
  }

  function filtros(params) {
    const lista = [];
    for (const [clave, v] of params) {
      if (["select", "order", "offset", "limit", "columns", "on_conflict"].includes(clave)) continue;
      if (clave === "or") {
        const partes = v.slice(1, -1).split(",").map((p) => {
          const i = p.indexOf(".");
          return condicion(p.slice(0, i), p.slice(i + 1));
        });
        lista.push((f) => partes.some((c) => c(f)));
      } else lista.push(condicion(clave, v));
    }
    return (f) => lista.every((c) => c(f));
  }

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const enviar = (estado, cuerpo) => {
      res.writeHead(estado, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*",
      });
      res.end(cuerpo === undefined ? "" : JSON.stringify(cuerpo));
    };
    if (req.method === "OPTIONS") return enviar(204);

    let crudo = "";
    req.on("data", (c) => (crudo += c));
    req.on("end", () => {
      try {
        if (url.pathname === "/auth/v1/user" && req.method === "PUT") {
          const { password } = JSON.parse(crudo || "{}");
          if (password !== undefined) {
            if (password === contrasena) return enviar(422, { code: 422, error_code: "same_password", msg: "Misma contraseña" });
            contrasena = password;
          }
          return enviar(200, USUARIO);
        }
        if (url.pathname === "/auth/v1/user") return enviar(200, USUARIO);
        if (url.pathname === "/auth/v1/token") {
          const { email, password } = JSON.parse(crudo || "{}");
          if (url.searchParams.get("grant_type") === "password" && (email !== USUARIO.email || !contrasena || password !== contrasena)) {
            return enviar(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
          }
          return enviar(200, sesionFalsa());
        }
        if (url.pathname === "/auth/v1/verify") {
          const { token } = JSON.parse(crudo || "{}");
          if (token !== "123456") return enviar(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
          return enviar(200, sesionFalsa());
        }
        if (url.pathname === "/__forzar_limite") {
          const { clave, activo } = JSON.parse(crudo);
          if (activo) limitesForzados.add(clave);
          else limitesForzados.delete(clave);
          return enviar(200, {});
        }
        // Ingreso por código: con create_user en false, un correo sin cuenta no entra (como Supabase).
        if (url.pathname === "/auth/v1/otp") {
          const { email, create_user } = JSON.parse(crudo || "{}");
          if (create_user === false && email !== USUARIO.email) {
            return enviar(422, { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" });
          }
          return enviar(200, {});
        }
        if (url.pathname === "/__contrasena") return enviar(200, { tiene: contrasena !== null });
        if (url.pathname.startsWith("/auth/v1/admin/users/")) {
          reiniciar(); // Borrar el usuario se lleva todo, como el "on delete cascade".
          tablas.profiles = [];
          return enviar(200, {});
        }
        if (url.pathname.startsWith("/auth/v1/")) return enviar(200, {});
        if (url.pathname === "/__estado") return enviar(200, tablas);
        if (url.pathname === "/__reiniciar") return reiniciar(), enviar(200, {});
        if (url.pathname === "/__sembrar") {
          const { tabla, fila } = JSON.parse(crudo);
          const nueva = completar(tabla, fila);
          tablas[tabla].push(nueva);
          return enviar(200, nueva);
        }
        if (url.pathname === "/__editar") {
          const { tabla, id, cambios } = JSON.parse(crudo);
          Object.assign(tabla === "profiles" ? tablas.profiles[0] : tablas[tabla].find((f) => f.id === id), cambios);
          return enviar(200, {});
        }
        if (url.pathname === "/rest/v1/rpc/sumar_uso_voz") {
          const { p_user, p_stt, p_tts } = JSON.parse(crudo);
          const mes = ahora().slice(0, 7) + "-01";
          let fila = tablas.voice_usage.find((f) => f.user_id === p_user && f.month === mes);
          if (!fila) tablas.voice_usage.push((fila = { user_id: p_user, month: mes, stt_seconds: 0, tts_chars: 0 }));
          fila.stt_seconds += Math.max(p_stt, 0);
          fila.tts_chars += Math.max(p_tts, 0);
          return enviar(200, [{ stt_seconds: fila.stt_seconds, tts_chars: fila.tts_chars }]);
        }

        // Las funciones de la migración 0005 (en la base real, solo para la clave de servicio).
        if (url.pathname === "/rest/v1/rpc/gasto_claude_mes") {
          const { p_user, p_mes } = JSON.parse(crudo);
          const delMes = tablas.llm_usage.filter((f) => f.mes === p_mes);
          const suma = (filas) => filas.reduce((t, f) => t + Number(f.cost_usd), 0);
          return enviar(200, [{ propio: suma(delMes.filter((f) => f.user_id === p_user)), global: suma(delMes) }]);
        }
        if (url.pathname === "/rest/v1/rpc/gasto_claude_desglose") {
          const { p_user, p_mes } = JSON.parse(crudo);
          const totales = new Map();
          for (const f of tablas.llm_usage.filter((x) => x.user_id === p_user && x.mes === p_mes)) {
            const clave = `${f.uso}|${f.model}`;
            totales.set(clave, (totales.get(clave) ?? 0) + Number(f.cost_usd));
          }
          return enviar(200, [...totales].map(([k, total]) => ({ uso: k.split("|")[0], model: k.split("|")[1], total })));
        }
        if (url.pathname === "/rest/v1/rpc/consumir_limite") {
          const { p_user, p_clave, p_por_minuto, p_por_dia } = JSON.parse(crudo);
          const minuto = new Date().toISOString().slice(0, 16);
          const dia = minuto.slice(0, 10);
          let f = tablas.limites_frecuencia.find((x) => x.user_id === p_user && x.clave === p_clave);
          if (!f) tablas.limites_frecuencia.push((f = { user_id: p_user, clave: p_clave, minuto, en_minuto: 0, dia, en_dia: 0 }));
          if (limitesForzados.has(p_clave)) return enviar(200, [{ permitido: false, en_minuto: 999, en_dia: 1 }]);
          f.en_minuto = f.minuto === minuto ? f.en_minuto + 1 : 1;
          f.en_dia = f.dia === dia ? f.en_dia + 1 : 1;
          Object.assign(f, { minuto, dia });
          return enviar(200, [{ permitido: f.en_minuto <= p_por_minuto && f.en_dia <= p_por_dia, en_minuto: f.en_minuto, en_dia: f.en_dia }]);
        }
        if (url.pathname === "/rest/v1/rpc/uso_voz_global") {
          const { p_month } = JSON.parse(crudo);
          const delMes = tablas.voice_usage.filter((f) => f.month === p_month);
          return enviar(200, [{
            stt_seconds: delMes.reduce((t, f) => t + f.stt_seconds, 0),
            tts_chars: delMes.reduce((t, f) => t + f.tts_chars, 0),
          }]);
        }

        const tabla = url.pathname.replace("/rest/v1/", "");
        const filas = tablas[tabla];
        if (!filas) return enviar(404, { message: `No existe ${tabla}` });
        const pasa = filtros(url.searchParams);
        const prefer = req.headers.prefer ?? "";
        const objeto = (req.headers.accept ?? "").includes("vnd.pgrst.object");
        const responder = (estado, resultado) => {
          if (objeto) {
            return resultado.length === 1 ? enviar(200, resultado[0]) : enviar(406, { code: "PGRST116", message: `${resultado.length} filas` });
          }
          return enviar(estado, resultado);
        };

        if (req.method === "GET" || req.method === "HEAD") {
          let resultado = filas.filter(pasa);
          for (const orden of (url.searchParams.get("order") ?? "").split(",").filter(Boolean).reverse()) {
            const [col, sentido] = orden.split(".");
            resultado = [...resultado].sort(
              (a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (sentido === "desc" ? -1 : 1),
            );
          }
          const desde = Number(url.searchParams.get("offset") ?? 0);
          const limite = Number(url.searchParams.get("limit") ?? 1000);
          return responder(200, resultado.slice(desde, desde + limite));
        }
        if (req.method === "POST") {
          const conflicto = (url.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean);
          const nuevas = [];
          for (const fila of [JSON.parse(crudo)].flat()) {
            const existente = prefer.includes("merge-duplicates") && conflicto.length
              ? filas.find((f) => conflicto.every((c) => String(f[c]) === String(fila[c] ?? (c === "user_id" ? USUARIO.id : undefined))))
              : null;
            if (existente) nuevas.push(Object.assign(existente, fila, { updated_at: ahora() }));
            else {
              const nueva = completar(tabla, fila);
              if (tabla === "tasks" && nueva.status === "hecha" && !nueva.completed_at) nueva.completed_at = ahora();
              filas.push(nueva);
              nuevas.push(nueva);
            }
          }
          return prefer.includes("return=representation") ? responder(201, nuevas) : enviar(201);
        }
        if (req.method === "PATCH") {
          const cambios = JSON.parse(crudo);
          const tocadas = filas.filter(pasa);
          for (const fila of tocadas) {
            const estadoAntes = fila.status;
            Object.assign(fila, cambios, { updated_at: ahora() });
            // Lo mismo que el disparador tasks_before_write.
            if (tabla === "tasks" && fila.status !== estadoAntes) {
              fila.status_changed_at = ahora();
              fila.completed_at = fila.status === "hecha" ? (fila.completed_at ?? ahora()) : null;
              if (fila.status !== "bloqueada") fila.blocked_reason = null;
            }
          }
          return prefer.includes("return=representation") ? responder(200, tocadas) : enviar(204);
        }
        if (req.method === "DELETE") {
          const borradas = filas.filter(pasa);
          tablas[tabla] = filas.filter((f) => !borradas.includes(f));
          const ids = borradas.map((f) => f.id);
          // Borrado en cascada, como las claves foráneas.
          if (tabla === "projects") {
            tablas.tasks = tablas.tasks.filter((t) => !ids.includes(t.project_id));
            tablas.project_log = tablas.project_log.filter((e) => !ids.includes(e.project_id));
          }
          if (tabla === "tasks") tablas.tasks = tablas.tasks.filter((t) => !ids.includes(t.parent_id));
          if (tabla === "sessions") tablas.messages = tablas.messages.filter((m) => !ids.includes(m.session_id));
          return prefer.includes("return=representation") ? responder(200, borradas) : enviar(204);
        }
        enviar(405, { message: "Método no soportado" });
      } catch (error) {
        enviar(400, { message: String(error) });
      }
    });
  });
  servidor.estado = () => tablas;
  servidor.reiniciar = reiniciar;
  servidor.sembrar = (tabla, fila) => {
    const nueva = completar(tabla, fila);
    tablas[tabla].push(nueva);
    return nueva;
  };
  return servidor;
}

module.exports = { crearServidor, cookieDeSesion, jwtFalso, USUARIO };
