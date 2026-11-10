import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, supabaseConfigurado } from "@/lib/env";

// /configurar solo es pública mientras falte Supabase (ese caso se resuelve antes).
const RUTAS_PUBLICAS = ["/ingresar", "/auth"];

/**
 * Refresca la sesión de Supabase en cada pedido y manda a /ingresar a quien no
 * tenga sesión. Es un chequeo optimista: la barrera real es RLS en la base y la
 * validación de sesión en cada endpoint.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const esPublica = RUTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  if (!supabaseConfigurado) {
    if (pathname === "/configurar") return NextResponse.next();
    return NextResponse.redirect(new URL("/configurar", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
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

  return response;
}

export const config = {
  matcher: [
    // Todo menos archivos estáticos, el service worker, el manifest y el endpoint
    // del programador (que se protege con su propio secreto).
    "/((?!_next/static|_next/image|favicon.ico|sw.js|sin-conexion.html|manifest.webmanifest|iconos/|api/cron/|.*\\.(?:png|svg|ico|webp)$).*)",
  ],
};
