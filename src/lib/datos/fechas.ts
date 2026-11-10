/**
 * Fechas de calendario como texto "AAAA-MM-DD", igual que las columnas `date`
 * de la base. Las cuentas se hacen en UTC para que no dependan de la zona del
 * dispositivo: la única zona que importa es la del perfil, y solo para saber
 * qué día es hoy.
 */

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function aUTC(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Arma una fecha y devuelve null si no existe (31/02, etc.). */
export function fechaValida(anio: number, mes: number, dia: number): string | null {
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  return aISO(f);
}

/** El día calendario de un instante en una zona horaria. */
export function fechaEnZona(instante: Date | string, zona: string): string {
  const fecha = typeof instante === "string" ? new Date(instante) : instante;
  try {
    // en-CA da el formato AAAA-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(fecha);
  } catch {
    // Zona desconocida para este navegador: se usa la del dispositivo.
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(fecha);
  }
}

export function hoyEnZona(zona: string, ahora: Date = new Date()): string {
  return fechaEnZona(ahora, zona);
}

export function sumarDias(iso: string, dias: number): string {
  const f = aUTC(iso);
  f.setUTCDate(f.getUTCDate() + dias);
  return aISO(f);
}

/** 0 = domingo … 6 = sábado (igual que en la base). */
export function diaSemana(iso: string): number {
  return aUTC(iso).getUTCDay();
}

/** Días de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diferenciaDias(desde: string, hasta: string): number {
  return Math.round((aUTC(hasta).getTime() - aUTC(desde).getTime()) / 86_400_000);
}

/** La semana va de lunes a domingo. */
export function lunesDe(iso: string): string {
  return sumarDias(iso, -((diaSemana(iso) + 6) % 7));
}

export function domingoDe(iso: string): string {
  return sumarDias(lunesDe(iso), 6);
}

/** Texto corto para una fecha límite: "Hoy", "Mañana", "jue 14", "14 nov". */
export function etiquetaFecha(iso: string, hoy: string): string {
  const dif = diferenciaDias(hoy, iso);
  if (dif === 0) return "Hoy";
  if (dif === 1) return "Mañana";
  if (dif === -1) return "Ayer";
  const [anio, mes, dia] = iso.split("-").map(Number);
  if (dif > 1 && dif < 7) return `${DIAS_CORTOS[diaSemana(iso)]} ${dia}`;
  const base = `${dia} ${MESES_CORTOS[mes - 1]}`;
  return anio === Number(hoy.slice(0, 4)) ? base : `${base} ${anio}`;
}

/** "jueves 14 de noviembre" */
export function fechaLarga(iso: string): string {
  const [, mes, dia] = iso.split("-").map(Number);
  return `${DIAS_LARGOS[diaSemana(iso)]} ${dia} de ${MESES[mes - 1]}`;
}

/** Las 42 celdas (6 semanas, de lunes a domingo) que muestran un mes. */
export function grillaMes(anio: number, mes: number): string[] {
  const inicio = lunesDe(aISO(new Date(Date.UTC(anio, mes - 1, 1))));
  return Array.from({ length: 42 }, (_, i) => sumarDias(inicio, i));
}
