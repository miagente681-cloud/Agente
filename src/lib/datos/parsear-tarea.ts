import { diaSemana, fechaValida, sumarDias } from "./fechas";

export type TareaParseada = {
  titulo: string;
  due_date: string | null;
  priority: number | null;
  /** Hora en que la vas a hacer, "HH:MM". */
  plan_hora: string | null;
};

const DIAS: Record<string, number> = {
  dom: 0, domingo: 0, lun: 1, lunes: 1, mar: 2, martes: 2, mie: 3, miercoles: 3,
  jue: 4, jueves: 4, vie: 5, viernes: 5, sab: 6, sabado: 6,
};

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Alta de tarea en una línea. Lee fecha, hora y prioridad solo si están AL
 * FINAL del texto ("Pintar el cuarto vie a las 15 p1"), para no comerse
 * palabras del título como en "Preparar la reunión de mañana con Ana".
 * Entiende: hoy, mañana, día de la semana (el próximo), 14/11, 14/11/2027,
 * p1 a p4, y la hora como 15:30, 15hs, 9h o «a las 15».
 */
export function parsearTarea(texto: string, hoy: string): TareaParseada {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  let due_date: string | null = null;
  let priority: number | null = null;
  let plan_hora: string | null = null;

  while (palabras.length > 1) {
    const ultima = sinTildes(palabras[palabras.length - 1]);
    const prioridad = /^p([1-4])$/.exec(ultima);
    if (prioridad && priority === null) {
      priority = Number(prioridad[1]);
      palabras.pop();
      continue;
    }
    if (due_date === null && leerFecha(ultima, hoy)) {
      due_date = leerFecha(ultima, hoy);
      palabras.pop();
      continue;
    }
    const leida: HoraLeida | null = plan_hora === null ? leerHora(palabras.map(sinTildes)) : null;
    // Siempre tiene que quedar algo de título.
    if (leida && palabras.length > leida.palabras) {
      plan_hora = leida.hora;
      palabras.splice(palabras.length - leida.palabras, leida.palabras);
      continue;
    }
    break;
  }
  return { titulo: palabras.join(" "), due_date, priority, plan_hora };
}

/**
 * La hora al final de las palabras, y cuántas palabras ocupa. Un número solo
 * («10») es hora únicamente después de «a las» o «a la», para no confundirlo
 * con una cantidad («Comprar huevos 12»). Con dos puntos o «hs» no hay duda.
 */
type HoraLeida = { hora: string; palabras: number };

function leerHora(palabras: string[]): HoraLeida | null {
  const ultima = palabras[palabras.length - 1];
  const m = /^([01]?\d|2[0-3])(?::([0-5]\d))?(hs?)?$/.exec(ultima);
  if (!m) return null;
  const hora = `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`;
  const anterior = (n: number) => palabras[palabras.length - 1 - n];
  const conArticulo = (anterior(1) === "las" || anterior(1) === "la") && anterior(2) === "a";
  if (m[2] || m[3]) {
    // "15:30", "a las 15:30", "de las 15hs".
    if (conArticulo) return { hora, palabras: 3 };
    if (anterior(1) === "las" && anterior(2) === "de") return { hora, palabras: 3 };
    return { hora, palabras: 1 };
  }
  return conArticulo ? { hora, palabras: 3 } : null;
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
