import { resumenInforme } from "./calcular";
import type { DatosInforme } from "./tipos";

/**
 * La «lectura del Agente»: un párrafo corto que acompaña a los números de un
 * informe. Lo escribe el modelo liviano a partir del resumen ya calculado;
 * nunca calcula nada. Si el modelo no está o tarda, el informe sale sin lectura.
 */

export const INSTRUCCIONES_LECTURA = `Sos el coach de proyectos de una persona y le escribís la lectura de un informe sobre sus tareas. Te paso los números ya calculados. Respondé con un solo párrafo de 2 a 4 oraciones, en español rioplatense con voseo, directo y sin adular: qué muestran los números, cuál es el punto más flojo y un consejo concreto para el próximo período. Usá solo los números que te paso; no inventes otros ni nombres tareas que no figuran. Si hay muy pocos datos para concluir algo, decilo en una oración. Sin títulos, sin listas, sin asteriscos.`;

/** Tiempo máximo que el informe espera por la lectura. */
export const ESPERA_LECTURA_MS = 12_000;
const LARGO_MAXIMO = 900;

const diaMes = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;

export function entradaLectura(titulo: string, datos: DatosInforme): string {
  return [
    `Informe: ${titulo}`,
    `Período: del ${diaMes(datos.desde)} al ${diaMes(datos.hasta)}` + (datos.filtro ? ` · ${datos.filtro}` : ""),
    `Hoy es ${diaMes(datos.hoy)}.`,
    "Números:",
    ...resumenInforme(datos).map((l) => `- ${l.slice(0, 500)}`),
  ].join("\n");
}

/** Deja la respuesta del modelo como un párrafo de texto plano, o null si no sirve. */
export function limpiarLectura(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpio = texto
    .replace(/[*_#`]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["«“](.*)["»”]$/, "$1")
    .trim();
  if (limpio.length < 20) return null;
  if (limpio.length <= LARGO_MAXIMO) return limpio;
  // Se corta en el final de una oración para no dejar una frase a medias.
  const recorte = limpio.slice(0, LARGO_MAXIMO);
  const fin = recorte.lastIndexOf(". ");
  return fin > 200 ? recorte.slice(0, fin + 1) : recorte.trimEnd() + "…";
}
