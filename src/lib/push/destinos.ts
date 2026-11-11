/**
 * Destinos válidos para una notificación push: solo `https` y solo los
 * servicios de push de los navegadores. Es la misma lista que la restricción
 * `push_endpoint_conocido` de la base (supabase/migrations/0005_seguridad.sql).
 *
 * - Chrome, Opera, Brave, Samsung Internet: fcm.googleapis.com
 * - Firefox: updates.push.services.mozilla.com
 * - Safari (macOS y la app instalada en iPhone): web.push.apple.com (*.push.apple.com)
 * - Edge: *.notify.windows.com
 */
const EXACTOS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.apple.com"]);
const SUFIJOS = [".push.apple.com", ".notify.windows.com"];
const ETIQUETA = /^[a-z0-9-]+$/;

export function destinoPushValido(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  if (EXACTOS.has(host)) return true;
  return SUFIJOS.some((s) => {
    if (!host.endsWith(s)) return false;
    const resto = host.slice(0, -s.length);
    // *.notify.windows.com admite una sola etiqueta; *.push.apple.com, varias.
    const etiquetas = resto.split(".");
    return etiquetas.length >= 1 && etiquetas.every((e) => ETIQUETA.test(e)) && (s === ".push.apple.com" || etiquetas.length === 1);
  });
}
