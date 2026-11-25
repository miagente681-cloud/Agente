import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { GeistMono } from "geist/font/mono";
import { RegistrarServiceWorker } from "@/components/registrar-sw";
import { COOKIE_ACENTO, COOKIE_TEMA, FONDO, leerAcento, leerTema, variablesDeAcento } from "@/lib/tema/acento";
import "./globals.css";

// Tipografías servidas por la propia app (sin pedidos a otros sitios). Licencias en ./fuentes.
const inter = localFont({
  src: "./fuentes/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const instrument = localFont({
  src: [
    { path: "./fuentes/instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fuentes/instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "MiAgente", template: "%s · MiAgente" },
  description: "Tu project manager personal, con un Agente que te llama y te hace avanzar.",
  applicationName: "MiAgente",
  appleWebApp: { capable: true, title: "MiAgente", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/iconos/icono.svg", type: "image/svg+xml" },
      { url: "/iconos/icono-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/iconos/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

/** El color de la barra del navegador y de los controles nativos acompaña al tema elegido. */
export async function generateViewport(): Promise<Viewport> {
  const tema = leerTema((await cookies()).get(COOKIE_TEMA)?.value);
  return {
    themeColor:
      tema === "sistema"
        ? [
            { media: "(prefers-color-scheme: light)", color: FONDO.claro },
            { media: "(prefers-color-scheme: dark)", color: FONDO.oscuro },
          ]
        : FONDO[tema],
    colorScheme: tema === "sistema" ? "dark light" : tema === "claro" ? "light" : "dark",
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Todas las páginas se arman en cada pedido: la política de contenido lleva
  // un nonce nuevo cada vez y Next se lo pone a sus scripts al renderizar.
  await connection();
  // El aspecto elegido en este dispositivo viaja en cookies: la página sale
  // ya con su tema y su color, sin un parpadeo del anterior.
  const galletas = await cookies();
  const tema = leerTema(galletas.get(COOKIE_TEMA)?.value);
  const acento = variablesDeAcento(leerAcento(galletas.get(COOKIE_ACENTO)?.value));
  return (
    <html
      lang="es-UY"
      data-tema={tema}
      style={acento as CSSProperties}
      className={`${inter.variable} ${instrument.variable} ${GeistMono.variable} h-full`}
      // El tema y el color se cambian desde el navegador sin recargar.
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <div aria-hidden className="franja-estado" />
        {children}
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
