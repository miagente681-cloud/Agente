import type { Tono } from "./escena";

/**
 * Colores de los gráficos. Los tres de las series son los primeros del
 * catálogo de referencia (azul, naranja, verde agua), en el escalón de cada
 * modo. Se validaron de a pares con el verificador de paletas contra las dos
 * superficies: distinguibles con visión normal (ΔE ≥ 20) y con daltonismo
 * (ΔE ≥ 9). No cambiarlos «a ojo»: si hace falta otro, validarlo igual.
 *
 * En papel, el verde agua queda apenas por debajo de 3:1 de contraste con el
 * blanco; por eso en el PDF los valores van siempre escritos.
 */
export const TEMA_PANTALLA: Record<Tono, string> = {
  serie1: "#3987e5",
  serie2: "#d95926",
  serie3: "#199e70",
  grilla: "#2a2a2a",
  eje: "#3d3d3d",
  texto: "#f0f0f0",
  texto2: "#a6a6a6",
  tenue: "#8c8c8c",
  superficie: "#131313",
};

/**
 * Lo que usa la pantalla: variables de CSS (definidas en globals.css), para
 * que los gráficos sigan al tema. En el tema oscuro valen los colores de
 * TEMA_PANTALLA y en el claro los de TEMA_PAPEL (los dos juegos validados);
 * tests/tema.test.ts comprueba que globals.css no se desfase de estos.
 */
export const TEMA_SEGUN_TEMA: Record<Tono, string> = {
  serie1: "var(--grafico-serie1)",
  serie2: "var(--grafico-serie2)",
  serie3: "var(--grafico-serie3)",
  grilla: "var(--grafico-grilla)",
  eje: "var(--grafico-eje)",
  texto: "var(--color-texto)",
  texto2: "var(--color-texto-2)",
  tenue: "var(--color-texto-3)",
  superficie: "var(--color-panel)",
};

export const TEMA_PAPEL: Record<Tono, string> = {
  serie1: "#2a78d6",
  serie2: "#eb6834",
  serie3: "#1baf7a",
  grilla: "#e1e0d9",
  eje: "#c3c2b7",
  texto: "#0b0b0b",
  texto2: "#52514e",
  tenue: "#898781",
  superficie: "#ffffff",
};
