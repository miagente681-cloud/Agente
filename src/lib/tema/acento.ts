/**
 * Aspecto de la app: tema (oscuro, claro o el del sistema) y color principal.
 * Lógica pura: la usan el servidor (para armar la página ya con el aspecto
 * elegido, sin parpadeo) y el navegador (para cambiarlo al instante).
 *
 * La elección se guarda en cookies del dispositivo. No protege nada: es solo
 * cómo se ve la app en ese dispositivo.
 */

export type Tema = "oscuro" | "claro" | "sistema";
export const TEMAS: { valor: Tema; nombre: string }[] = [
  { valor: "oscuro", nombre: "Oscuro" },
  { valor: "claro", nombre: "Claro" },
  { valor: "sistema", nombre: "Automático" },
];
export const TEMA_POR_DEFECTO: Tema = "oscuro";

export const COOKIE_TEMA = "miagente-tema";
export const COOKIE_ACENTO = "miagente-acento";

/** Fondo de cada tema, para el color de la barra del navegador. */
export const FONDO = { oscuro: "#000000", claro: "#ededed" } as const;

/**
 * Colores principales que se ofrecen. `null` es «sin color»: la app queda en
 * blanco y negro y lo destacado va en el color del texto. Además se puede
 * elegir cualquier otro con el selector del sistema.
 */
export const ACENTOS: { nombre: string; color: string | null }[] = [
  { nombre: "Sin color", color: null },
  { nombre: "Rojo", color: "#f2473b" },
  { nombre: "Naranja", color: "#ff7a1a" },
  { nombre: "Ámbar", color: "#ffb000" },
  { nombre: "Lima", color: "#b6e62e" },
  { nombre: "Verde", color: "#2fbf71" },
  { nombre: "Turquesa", color: "#18b8b0" },
  { nombre: "Celeste", color: "#2fa8f5" },
  { nombre: "Azul", color: "#3d6bff" },
  { nombre: "Violeta", color: "#8b5cf6" },
  { nombre: "Rosa", color: "#f0509b" },
];

export function leerTema(valor: string | null | undefined): Tema {
  return TEMAS.some((t) => t.valor === valor) ? (valor as Tema) : TEMA_POR_DEFECTO;
}

/** Devuelve el color como #rrggbb en minúsculas, o null si no es un color (o es «sin color»). */
export function leerAcento(valor: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((valor ?? "").trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

// --- Contraste -------------------------------------------------------------------

type Rgb = [number, number, number];

function aRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const aHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;

/** Luminancia relativa (WCAG), de 0 a 1. */
export function luminancia(hex: string): number {
  const [r, g, b] = aRgb(hex).map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste entre dos colores (WCAG), de 1 a 21. */
export function contraste(a: string, b: string): number {
  const [clara, oscura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (oscura + 0.05);
}

/** Mezcla `hex` con blanco o negro, en la proporción `t` (0 = sin cambio). */
function hacia(hex: string, destino: 0 | 255, t: number): string {
  return aHex(aRgb(hex).map((x) => x + (destino - x) * t) as Rgb);
}

/**
 * El mismo color, aclarado u oscurecido lo justo para leerse como texto
 * (4,5:1) sobre `fondo`. Un amarillo sobre blanco no se lee: se oscurece.
 */
function legibleSobre(hex: string, fondo: string): string {
  const destino = luminancia(fondo) < 0.5 ? 255 : 0;
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const candidato = hacia(hex, destino, t);
    if (contraste(candidato, fondo) >= MINIMO_TEXTO) return candidato;
  }
  return destino === 255 ? "#ffffff" : "#000000";
}

export const MINIMO_TEXTO = 4.5;
/**
 * Las superficies más difíciles de cada tema para un texto de color: en el
 * oscuro, la más clara («elevado»); en el claro, la más oscura («fondo»).
 * Tienen que coincidir con globals.css (lo comprueba tests/tema.test.ts).
 */
export const SUPERFICIE_CRITICA = { oscuro: "#1f1f1f", claro: "#ededed" } as const;

export type AcentoDerivado = {
  /** El color tal cual, para rellenos. */
  relleno: string;
  /** Negro o blanco: lo que se lee encima del relleno. */
  sobre: string;
  /** El color llevado a un tono que se lee como texto en cada tema. */
  texto: { oscuro: string; claro: string };
};

export function derivarAcento(hex: string): AcentoDerivado {
  return {
    relleno: hex,
    sobre: contraste(hex, "#000000") >= contraste(hex, "#ffffff") ? "#000000" : "#ffffff",
    texto: {
      oscuro: legibleSobre(hex, SUPERFICIE_CRITICA.oscuro),
      claro: legibleSobre(hex, SUPERFICIE_CRITICA.claro),
    },
  };
}

/**
 * Las variables que van sobre <html> para el color elegido (las lee
 * globals.css). Sin color elegido no va ninguna y valen las de «sin color».
 */
export function variablesDeAcento(hex: string | null): Record<string, string> {
  if (!hex) return {};
  const a = derivarAcento(hex);
  return {
    "--acento-o": a.relleno,
    "--sobre-acento-o": a.sobre,
    "--acento-texto-o": a.texto.oscuro,
    "--acento-suave-o": `${a.texto.oscuro}24`,
    "--acento-c": a.relleno,
    "--sobre-acento-c": a.sobre,
    "--acento-texto-c": a.texto.claro,
    "--acento-suave-c": `${a.texto.claro}1c`,
  };
}

export const NOMBRES_DE_VARIABLES = Object.keys(variablesDeAcento("#000000"));
