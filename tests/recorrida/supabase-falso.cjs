/**
 * Supabase de mentira para recorrer la app en un navegador sin un proyecto real.
 * Guarda todo en memoria y entiende lo justo de PostgREST que usa el panel
 * (eq, is.null, not.is.null, or, order, offset/limit). No valida RLS: eso lo
 * cubre tests/esquema.test.ts contra un Postgres de verdad.
 */
const http = require("node:http");

const USUARIO = { id: "11111111-1111-1111-1111-111111111111", email: "prueba@ejemplo.com", aud: "authenticated", role: "authenticated" };
const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

/** Cookie de sesión como la escribe @supabase/ssr. La firma solo tiene que ser base64url válido. */
function cookieDeSesion() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: USUARIO.id, email: USUARIO.email, role: "authenticated", aud: "authenticated", exp }),
    Buffer.alloc(32, 7).toString("base64url"),
  ].join(".");
  const sesion = { access_token: jwt, refresh_token: "falso", token_type: "bearer", expires_in: 3600, expires_at: exp, user: USUARIO };
  return { name: "sb-127-auth-token", value: "base64-" + b64(sesion) };
}

function crearServidor() {
  const ahora = () => new Date().toISOString();
  const tablas = {
    profiles: [{ user_id: USUARIO.id, name: "Prueba", timezone: "America/Montevideo" }],
    areas: [], projects: [], tasks: [], project_log: [],
  };
  const DEFECTOS = {
    areas: () => ({ archived_at: null }),
    projects: () => ({ created_at: ahora() }),
    tasks: () => ({ status: "pendiente", priority: 2, completed_at: null, archived_at: null, created_at: ahora(), status_changed_at: ahora() }),
    project_log: () => ({ created_at: ahora() }),
  };

  function condicion(columna, expr) {
    if (expr === "is.null") return (f) => f[columna] == null;
    if (expr === "not.is.null") return (f) => f[columna] != null;
    if (expr.startsWith("eq.")) return (f) => String(f[columna]) === expr.slice(3);
    throw new Error(`Filtro no soportado: ${columna}=${expr}`);
  }

  function filtros(params) {
    const lista = [];
    for (const [clave, valor] of params) {
      if (["select", "order", "offset", "limit", "columns"].includes(clave)) continue;
      if (clave === "or") {
        const partes = valor.slice(1, -1).split(",").map((p) => {
          const i = p.indexOf(".");
          return condicion(p.slice(0, i), p.slice(i + 1));
        });
        lista.push((f) => partes.some((c) => c(f)));
      } else lista.push(condicion(clave, valor));
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
        if (url.pathname.startsWith("/auth/v1/")) return enviar(200, {});
        if (url.pathname === "/__estado") return enviar(200, tablas);
        if (url.pathname === "/__sembrar") {
          const { tabla, fila } = JSON.parse(crudo);
          tablas[tabla].push({ ...DEFECTOS[tabla]?.(), ...fila });
          return enviar(200, {});
        }

        const tabla = url.pathname.replace("/rest/v1/", "");
        const filas = tablas[tabla];
        if (!filas) return enviar(404, { message: `No existe ${tabla}` });
        const pasa = filtros(url.searchParams);

        if (req.method === "GET") {
          let resultado = filas.filter(pasa);
          for (const orden of (url.searchParams.get("order") ?? "").split(",").filter(Boolean).reverse()) {
            const [col, sentido] = orden.split(".");
            resultado = [...resultado].sort(
              (a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (sentido === "desc" ? -1 : 1),
            );
          }
          const desde = Number(url.searchParams.get("offset") ?? 0);
          const limite = Number(url.searchParams.get("limit") ?? 1000);
          resultado = resultado.slice(desde, desde + limite);
          if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
            return resultado.length === 1 ? enviar(200, resultado[0]) : enviar(406, { code: "PGRST116", message: "0 filas" });
          }
          return enviar(200, resultado);
        }
        if (req.method === "POST") {
          const nuevas = [JSON.parse(crudo)].flat();
          for (const fila of nuevas) filas.push({ ...DEFECTOS[tabla]?.(), ...fila });
          return enviar(201);
        }
        if (req.method === "PATCH") {
          const cambios = JSON.parse(crudo);
          for (const fila of filas.filter(pasa)) {
            const estadoAntes = fila.status;
            Object.assign(fila, cambios);
            // Lo mismo que el disparador tasks_before_write.
            if (tabla === "tasks" && fila.status !== estadoAntes) {
              fila.status_changed_at = ahora();
              fila.completed_at = fila.status === "hecha" ? ahora() : null;
              if (fila.status !== "bloqueada") fila.blocked_reason = null;
            }
          }
          return enviar(204);
        }
        if (req.method === "DELETE") {
          const borradas = filas.filter(pasa);
          tablas[tabla] = filas.filter((f) => !borradas.includes(f));
          // Borrado en cascada, como las claves foráneas.
          if (tabla === "projects") {
            const ids = borradas.map((p) => p.id);
            tablas.tasks = tablas.tasks.filter((t) => !ids.includes(t.project_id));
            tablas.project_log = tablas.project_log.filter((e) => !ids.includes(e.project_id));
          }
          if (tabla === "tasks") {
            const ids = borradas.map((t) => t.id);
            tablas.tasks = tablas.tasks.filter((t) => !ids.includes(t.parent_id));
          }
          return enviar(204);
        }
        enviar(405, { message: "Método no soportado" });
      } catch (error) {
        enviar(400, { message: String(error) });
      }
    });
  });
  return servidor;
}

module.exports = { crearServidor, cookieDeSesion, USUARIO };
