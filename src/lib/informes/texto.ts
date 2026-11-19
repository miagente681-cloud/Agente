import { MESES } from "@/lib/datos/fechas";
import { decirValor } from "./calcular";
import { INFO_MEDIDA, type BloqueNumero } from "./tipos";

/** Textos que comparten la pantalla y el PDF. */

const MESES_CORTOS = MESES.map((m) => m.slice(0, 3));
const partes = (iso: string) => ({ a: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8)) });

/** «5 nov», o «5 nov 2025» si se pide el año. */
export function fechaCorta(iso: string, conAnio = false): string {
  const { a, m, d } = partes(iso);
  return `${d} ${MESES_CORTOS[m - 1]}` + (conAnio ? ` ${a}` : "");
}

/** «1 al 30 de noviembre de 2026», «15 de octubre al 14 de noviembre de 2026». */
export function periodoLegible(desde: string, hasta: string): string {
  const x = partes(desde);
  const y = partes(hasta);
  const fin = `${y.d} de ${MESES[y.m - 1]} de ${y.a}`;
  if (desde === hasta) return fin;
  if (x.a !== y.a) return `${x.d} de ${MESES[x.m - 1]} de ${x.a} al ${fin}`;
  if (x.m !== y.m) return `${x.d} de ${MESES[x.m - 1]} al ${fin}`;
  return `${x.d} al ${fin}`;
}

export type Comparacion = {
  /** «+4», «−2», «igual», «+10 puntos». */
  texto: string;
  direccion: "sube" | "baja" | "igual";
  /** Si el cambio es bueno, malo o ni una cosa ni la otra. */
  sentido: "bien" | "mal" | "neutro";
};

/** La comparación de un número con el período anterior, o null si no hay con qué comparar. */
export function comparar(b: BloqueNumero): Comparacion | null {
  if (b.valor === null || b.anterior === null) return null;
  const dif = Math.round((b.valor - b.anterior) * 10) / 10;
  if (dif === 0) return { texto: "igual", direccion: "igual", sentido: "neutro" };
  const signo = dif > 0 ? "+" : "−";
  const cantidad = String(Math.abs(dif)).replace(".", ",");
  const unidad = b.unidad === "%" ? (Math.abs(dif) === 1 ? " punto" : " puntos") : b.unidad === "días" ? (Math.abs(dif) === 1 ? " día" : " días") : "";
  const bueno = INFO_MEDIDA[b.medida].subirEsBueno;
  return {
    texto: `${signo}${cantidad}${unidad}`,
    direccion: dif > 0 ? "sube" : "baja",
    sentido: bueno === null ? "neutro" : (dif > 0) === bueno ? "bien" : "mal",
  };
}

/** Por qué un número no tiene valor: «—» solo no alcanza. */
export function motivoSinValor(b: BloqueNumero): string | null {
  if (b.valor !== null) return null;
  return b.medida === "atraso" ? "No hubo tareas hechas tarde." : "No hubo tareas hechas con fecha límite.";
}

export const valorDe = (b: BloqueNumero) => decirValor(b.valor, b.unidad);
