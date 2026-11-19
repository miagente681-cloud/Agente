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
  grilla: "#26262c",
  eje: "#3a3a43",
  texto: "#ededf0",
  texto2: "#a5a5b0",
  tenue: "#7d7d89",
  superficie: "#141417",
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
