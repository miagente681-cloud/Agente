import { diaSemana, fechaValida, sumarDias } from "./fechas";

export type TareaParseada = { titulo: string; due_date: string | null; priority: number | null };

const DIAS: Record<string, number> = {
  dom: 0, domingo: 0, lun: 1, lunes: 1, mar: 2, martes: 2, mie: 3, miercoles: 3,
  jue: 4, jueves: 4, vie: 5, viernes: 5, sab: 6, sabado: 6,
};

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Alta de tarea en una línea. Lee fecha y prioridad solo si están AL FINAL del
 * texto ("Pintar el cuarto vie p1"), para no comerse palabras del título como
 * en "Preparar la reunión de mañana con Ana".
 * Entiende: hoy, mañana, día de la semana (el próximo), 14/11, 14/11/2027, p1 a p4.
 */
export function parsearTarea(texto: string, hoy: string): TareaParseada {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  let due_date: string | null = null;
  let priority: number | null = null;

  while (palabras.length > 1) {
    const ultima = sinTildes(palabras[palabras.length - 1]);
    const prioridad = /^p([1-4])$/.exec(ultima);
    if (prioridad && priority === null) {
      priority = Number(prioridad[1]);
    } else if (due_date === null && leerFecha(ultima, hoy)) {
      due_date = leerFecha(ultima, hoy);
    } else {
      break;
    }
    palabras.pop();
  }
  return { titulo: palabras.join(" "), due_date, priority };
}

function leerFecha(palabra: string, hoy: string): string | null {
  if (palabra === "hoy") return hoy;
  if (palabra === "manana") return sumarDias(hoy, 1);
  if (palabra in DIAS) {
    // El próximo día con ese nombre; si es hoy, el de la semana que viene.
    const faltan = (DIAS[palabra] - diaSemana(hoy) + 7) % 7 || 7;
    return sumarDias(hoy, faltan);
  }
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(palabra);
  if (!m) return null;
  const anioHoy = Number(hoy.slice(0, 4));
  if (m[3]) return fechaValida(Number(m[3]), Number(m[2]), Number(m[1]));
  // Sin año: este año, o el que viene si esa fecha ya pasó.
  const esteAnio = fechaValida(anioHoy, Number(m[2]), Number(m[1]));
  if (esteAnio && esteAnio >= hoy) return esteAnio;
  return fechaValida(anioHoy + 1, Number(m[2]), Number(m[1])) ?? esteAnio;
}
