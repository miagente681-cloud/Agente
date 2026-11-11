import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { RegistrarServiceWorker } from "@/components/registrar-sw";
import "./globals.css";

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

export const viewport: Viewport = {
  themeColor: "#0c0c0e",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Todas las páginas se arman en cada pedido: la política de contenido lleva
  // un nonce nuevo cada vez y Next se lo pone a sus scripts al renderizar.
  await connection();
  return (
    <html lang="es-UY" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <RegistrarServiceWorker />
      </body>
    </html>
  );
}
