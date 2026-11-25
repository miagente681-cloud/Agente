import { diaSemana, sumarDias } from "./fechas";

/**
 * Cuándo es la próxima llamada del Agente según las rutinas, cuando todavía
 * no existe la sesión (el programador crea la de cada día ese mismo día).
 * Lógica pura: recibe el día y la hora actuales, no lee el reloj.
 */

export type RutinaLlamada = {
  weekdays: number[]; // 0 = domingo … 6 = sábado
  local_time: string; // "HH:MM" o "HH:MM:SS"
  focus: string | null;
  active: boolean;
};

export type ProximaDeRutina = { fecha: string; hora: string; foco: string | null };

/** La primera vez que toca una rutina activa desde ahora, mirando hasta una semana adelante. */
export function proximaDeRutinas(rutinas: RutinaLlamada[], hoy: string, horaAhora: string): ProximaDeRutina | null {
  const activas = rutinas.filter((r) => r.active);
  for (let i = 0; i <= 7; i++) {
    const fecha = sumarDias(hoy, i);
    const dia = diaSemana(fecha);
    const delDia = activas
      .filter((r) => r.weekdays.includes(dia))
      .map((r) => ({ hora: r.local_time.slice(0, 5), foco: r.focus }))
      // Hoy solo cuentan las que todavía no pasaron.
      .filter((r) => i > 0 || r.hora > horaAhora)
      .sort((a, b) => a.hora.localeCompare(b.hora));
    if (delDia.length) return { fecha, ...delDia[0] };
  }
  return null;
}

/** «en 25 min», «en 3 h», o null si falta un día o más (ahí se dice el día). */
export function cuantoFalta(minutos: number): string | null {
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `en ${Math.round(minutos)} min`;
  if (minutos < 24 * 60) return `en ${Math.round(minutos / 60)} h`;
  return null;
}
