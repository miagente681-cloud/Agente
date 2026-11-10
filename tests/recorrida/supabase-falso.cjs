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
  "messages", "project_log", "memories", "change_log", "push_subscriptions", "voice_usage",
];

function crearServidor() {
  const ahora = () => new Date().toISOString();
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
        if (url.pathname === "/auth/v1/user") return enviar(200, USUARIO);
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
