import {
  COOKIE_ACENTO,
  COOKIE_TEMA,
  FONDO,
  leerAcento,
  leerTema,
  NOMBRES_DE_VARIABLES,
  variablesDeAcento,
  type Tema,
} from "./acento";

/**
 * Cambia el aspecto en el navegador: lo aplica al instante sobre <html> y lo
 * deja en una cookie, para que el servidor arme las páginas siguientes ya con
 * ese aspecto (sin un parpadeo del tema anterior al cargar).
 */

const UN_ANIO_S = 365 * 24 * 60 * 60;

function guardar(nombre: string, valor: string | null): void {
  const vida = valor === null ? 0 : UN_ANIO_S;
  document.cookie = `${nombre}=${encodeURIComponent(valor ?? "")}; path=/; max-age=${vida}; samesite=lax`;
}

/** El tema guardado en este dispositivo. */
export function temaActual(): Tema {
  return leerTema(document.documentElement.dataset.tema);
}

/** Si en este momento la app se ve oscura (resuelve «sistema» con lo que diga el dispositivo). */
export function seVeOscuro(): boolean {
  const tema = temaActual();
  if (tema !== "sistema") return tema === "oscuro";
  return !window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.tema = tema;
  guardar(COOKIE_TEMA, tema);
  // El color de la barra del navegador acompaña al tema.
  const fondo = FONDO[seVeOscuro() ? "oscuro" : "claro"];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", fondo));
  window.dispatchEvent(new Event(EVENTO_ASPECTO));
}

/** El color principal guardado en este dispositivo, o null si es «sin color». */
export function acentoActual(): string | null {
  return leerAcento(document.documentElement.style.getPropertyValue("--acento-o"));
}

export function aplicarAcento(color: string | null): void {
  const limpio = leerAcento(color);
  const estilo = document.documentElement.style;
  for (const nombre of NOMBRES_DE_VARIABLES) estilo.removeProperty(nombre);
  for (const [nombre, valor] of Object.entries(variablesDeAcento(limpio))) estilo.setProperty(nombre, valor);
  // Sin el «#», que en una cookie hay que escapar.
  guardar(COOKIE_ACENTO, limpio ? limpio.slice(1) : null);
  window.dispatchEvent(new Event(EVENTO_ASPECTO));
}

/** Se dispara cuando cambia el tema o el color, para que lo que los muestra se actualice. */
export const EVENTO_ASPECTO = "miagente:aspecto";
