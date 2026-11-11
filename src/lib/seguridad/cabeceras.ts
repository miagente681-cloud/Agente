/**
 * Cabeceras de seguridad. La política de contenido (CSP) lleva un nonce por
 * pedido: solo corren los scripts que Next marca con él. Las cookies de
 * sesión de Supabase se pueden leer desde JavaScript, así que esta es la
 * defensa ante una inyección de código.
 */

function origenDe(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function politicaDeContenido(p: { nonce: string; supabaseUrl: string; desarrollo?: boolean }): string {
  const supabase = origenDe(p.supabaseUrl);
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : null;
  const conectar = [
    "'self'",
    supabase,
    supabaseWs,
    // Azure Speech: reconocimiento y voz por WebSocket, directo desde el navegador con un token corto.
    "wss://*.stt.speech.microsoft.com",
    "wss://*.tts.speech.microsoft.com",
    "https://*.stt.speech.microsoft.com",
    "https://*.tts.speech.microsoft.com",
  ].filter(Boolean);
  const directivas = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${p.nonce}' 'strict-dynamic'${p.desarrollo ? " 'unsafe-eval'" : ""}`,
    // React escribe atributos style en el HTML; los estilos no ejecutan código.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${conectar.join(" ")}`,
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ];
  if (!p.desarrollo && supabase?.startsWith("https:")) directivas.push("upgrade-insecure-requests");
  return directivas.join("; ");
}

/** Micrófono solo para el propio sitio (llamadas); el resto, apagado. */
export const POLITICA_DE_PERMISOS = [
  "microphone=(self)",
  "camera=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "hid=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "display-capture=()",
  "browsing-topics=()",
].join(", ");

/**
 * Los endpoints que modifican algo solo aceptan pedidos de la propia app:
 * el encabezado Origin tiene que coincidir con el host del pedido.
 */
export function origenValido(p: { metodo: string; origen: string | null; host: string | null }): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(p.metodo.toUpperCase())) return true;
  if (!p.origen || !p.host) return false;
  const origen = origenDe(p.origen);
  if (!origen) return false;
  return new URL(origen).host.toLowerCase() === p.host.toLowerCase();
}
