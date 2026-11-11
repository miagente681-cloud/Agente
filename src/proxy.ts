import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, supabaseConfigurado } from "@/lib/env";
import { origenValido, politicaDeContenido } from "@/lib/seguridad/cabeceras";

// /configurar solo es pública mientras falte Supabase (ese caso se resuelve antes).
const RUTAS_PUBLICAS = ["/ingresar", "/auth"];

/**
 * En cada pedido: arma la política de contenido con un nonce nuevo, frena los
 * pedidos que modifican algo y no vienen de la propia app (Origin), refresca la
 * sesión de Supabase y manda a /ingresar a quien no tenga sesión. Lo de la
 * sesión es un chequeo optimista: la barrera real es RLS en la base y la
 * validación de sesión en cada endpoint.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const esPublica = RUTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = politicaDeContenido({ nonce, supabaseUrl: SUPABASE_URL, desarrollo: process.env.NODE_ENV === "development" });
  const conCsp = <T extends NextResponse>(r: T): T => {
    r.headers.set("Content-Security-Policy", csp);
    return r;
  };
  // Next lee la política del pedido para poner el nonce en sus scripts.
  const siguiente = () => {
    const cabeceras = new Headers(request.headers);
    cabeceras.set("Content-Security-Policy", csp);
    cabeceras.set("x-nonce", nonce);
    return NextResponse.next({ request: { headers: cabeceras } });
  };

  if (
    pathname.startsWith("/api/") &&
    !origenValido({
      metodo: request.method,
      origen: request.headers.get("origin"),
      host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    })
  ) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  if (!supabaseConfigurado) {
    if (pathname === "/configurar") return conCsp(siguiente());
    return NextResponse.redirect(new URL("/configurar", request.url));
  }

  let response = siguiente();

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = siguiente();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const conSesion = Boolean(data?.claims?.sub);

  const redirigir = (destino: string) => {
    const redirect = NextResponse.redirect(new URL(destino, request.url));
    // Conserva las cookies de sesión que se hayan refrescado en este pedido.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!conSesion && !esPublica) {
    // Los endpoints responden 401 en lugar de redirigir a una página.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    }
    return redirigir("/ingresar");
  }
  if (conSesion && pathname === "/ingresar") return redirigir("/hoy");

  return conCsp(response);
}

export const config = {
  matcher: [
    // Todo menos archivos estáticos, el service worker, el manifest y el endpoint
    // del programador (que se protege con su propio secreto).
    "/((?!_next/static|_next/image|favicon.ico|sw.js|sin-conexion.html|manifest.webmanifest|iconos/|api/cron/|.*\\.(?:png|svg|ico|webp)$).*)",
  ],
};
