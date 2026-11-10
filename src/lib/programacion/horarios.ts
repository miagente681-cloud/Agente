/**
 * Lógica de horarios de las llamadas. Son funciones puras: reciben la hora
 * actual y los datos, y devuelven qué hay que hacer. No leen el reloj ni la
 * base, así se pueden probar con cualquier zona horaria y cualquier día.
 */

export type RutinaP = {
  id: string;
  name: string;
  weekdays: number[]; // 0 = domingo … 6 = sábado
  local_time: string; // "HH:MM" o "HH:MM:SS", en la zona del perfil
  target_minutes: number;
  focus: string | null;
  active: boolean;
};

export type Ventana = { weekday: number; start_time: string; end_time: string };

export type SesionP = {
  id: string;
  status: string;
  routine_id: string | null;
  rescheduled_from: string | null;
  scheduled_at: string | null;
  notified_at: string | null;
  reschedule_count: number;
  target_minutes: number | null;
};

export type Ajustes = { margenMinutos: number; maxReprogramaciones: number };

export const AJUSTES_POR_DEFECTO: Ajustes = { margenMinutos: 10, maxReprogramaciones: 2 };
/** Sin ventanas de disponibilidad cargadas se asume este horario, todos los días. */
export const VENTANA_POR_DEFECTO = { start_time: "08:00", end_time: "22:00" };
/** Una llamada ignorada no se reprograma para dentro de cinco minutos. */
export const ESPERA_MINIMA_MIN = 30;
const PASO_MIN = 5;
const DURACION_POR_DEFECTO = 10;

export function ajustesDe(config: Record<string, unknown> | null | undefined): Ajustes {
  const numero = (v: unknown, min: number, max: number, defecto: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : defecto;
  return {
    margenMinutos: numero(config?.margen_minutos, 1, 120, AJUSTES_POR_DEFECTO.margenMinutos),
    maxReprogramaciones: numero(config?.max_reprogramaciones, 0, 10, AJUSTES_POR_DEFECTO.maxReprogramaciones),
  };
}

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(zona: string): Intl.DateTimeFormat {
  let f = formatos.get(zona);
  if (!f) {
    const opciones: Intl.DateTimeFormatOptions = {
      hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    };
    try {
      f = new Intl.DateTimeFormat("en-US", { ...opciones, timeZone: zona });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { ...opciones, timeZone: "America/Montevideo" });
    }
    formatos.set(zona, f);
  }
  return f;
}

const DIAS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Fecha, hora y día de la semana de un instante, vistos desde una zona. */
export function partesEnZona(instante: Date, zona: string) {
  const p = Object.fromEntries(formato(zona).formatToParts(instante).map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    hora: `${p.hour}:${p.minute}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    diaSemana: DIAS_EN.indexOf(p.weekday),
    /** El mismo reloj de pared leído como si fuera UTC: sirve para calcular el desfase. */
    comoUTC: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second),
  };
}

/** El instante que corresponde a una fecha y hora de reloj en una zona. */
export function instanteLocal(fecha: string, hora: string, zona: string): Date {
  const [a, m, d] = fecha.split("-").map(Number);
  const [h, min] = hora.split(":").map(Number);
  const pared = Date.UTC(a, m - 1, d, h, min);
  const desfase = (t: number) => partesEnZona(new Date(t), zona).comoUTC - Math.floor(t / 1000) * 1000;
  // Dos pasadas: la segunda corrige cuando el cambio de hora cae entre medio.
  let t = pared - desfase(pared);
  t = pared - desfase(t);
  return new Date(t);
}

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

const redondearArriba = (t: number) => Math.ceil(t / (PASO_MIN * 60_000)) * PASO_MIN * 60_000;

/**
 * Primer hueco libre a partir de `desde`: dentro de una ventana de
 * disponibilidad, con lugar para toda la llamada y sin pisar otra.
 */
export function proximoHueco(p: {
  desde: Date;
  zona: string;
  ventanas: Ventana[];
  ocupadas: { inicio: Date; fin: Date }[];
  duracionMin: number;
  dias?: number;
}): Date | null {
  const duracion = p.duracionMin * 60_000;
  const ocupadas = [...p.ocupadas].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const hoy = partesEnZona(p.desde, p.zona);

  for (let i = 0; i <= (p.dias ?? 7); i++) {
    const fecha = sumarDias(hoy.fecha, i);
    const [a, m, d] = fecha.split("-").map(Number);
    const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
    const delDia = p.ventanas.length
      ? p.ventanas.filter((v) => v.weekday === dia)
      : [{ weekday: dia, ...VENTANA_POR_DEFECTO }];

    for (const v of [...delDia].sort((x, y) => x.start_time.localeCompare(y.start_time))) {
      const fin = instanteLocal(fecha, v.end_time, p.zona).getTime();
      let t = redondearArriba(Math.max(instanteLocal(fecha, v.start_time, p.zona).getTime(), p.desde.getTime()));
      while (t + duracion <= fin) {
        const choque = ocupadas.find((o) => t < o.fin.getTime() && t + duracion > o.inicio.getTime());
        if (!choque) return new Date(t);
        t = redondearArriba(choque.fin.getTime());
      }
    }
  }
  return null;
}

export type Accion =
  | { tipo: "crear"; rutina: RutinaP; cuando: string }
  | { tipo: "notificar"; sesion: SesionP }
  | { tipo: "reprogramar"; sesion: SesionP; cuando: string }
  | { tipo: "perder"; sesion: SesionP };

/**
 * Qué hay que hacer en este minuto para un usuario:
 *  1. crear las llamadas de hoy que todavía no existen,
 *  2. avisar de las que llegaron a su hora,
 *  3. reprogramar (o dar por perdidas) las que nadie atendió dentro del margen.
 */
export function decidir(p: {
  ahora: Date;
  zona: string;
  rutinas: RutinaP[];
  ventanas: Ventana[];
  sesiones: SesionP[];
  ajustes: Ajustes;
}): Accion[] {
  const acciones: Accion[] = [];
  const t = p.ahora.getTime();
  const margen = p.ajustes.margenMinutos * 60_000;
  const local = partesEnZona(p.ahora, p.zona);
  const fechaDe = (s: SesionP) => (s.scheduled_at ? partesEnZona(new Date(s.scheduled_at), p.zona).fecha : null);

  // 1. Llamadas de hoy. Solo cuentan las originales: una reprogramada desde
  //    ayer no impide la de hoy.
  for (const r of p.rutinas) {
    if (!r.active || !r.weekdays.includes(local.diaSemana)) continue;
    const yaEsta = p.sesiones.some(
      (s) => s.routine_id === r.id && !s.rescheduled_from && fechaDe(s) === local.fecha,
    );
    if (yaEsta) continue;
    const cuando = instanteLocal(local.fecha, r.local_time.slice(0, 5), p.zona);
    // Si la rutina se creó (o el programador volvió) con la hora ya pasada, no
    // se inventa una llamada perdida.
    if (cuando.getTime() < t - margen) continue;
    acciones.push({ tipo: "crear", rutina: r, cuando: cuando.toISOString() });
  }

  const pendientes = p.sesiones.filter((s) => s.scheduled_at && ["programada", "notificada"].includes(s.status));
  for (const s of pendientes) {
    const hora = new Date(s.scheduled_at as string).getTime();

    // 2. Llegó la hora.
    if (s.status === "programada") {
      if (hora <= t) acciones.push({ tipo: "notificar", sesion: s });
      continue;
    }

    // 3. Se avisó y pasó el margen sin que la atendieran.
    const aviso = s.notified_at ? new Date(s.notified_at).getTime() : hora;
    if (aviso + margen > t) continue;
    if (s.reschedule_count >= p.ajustes.maxReprogramaciones) {
      acciones.push({ tipo: "perder", sesion: s });
      continue;
    }
    const duracionDe = (x: SesionP) => (x.target_minutes ?? DURACION_POR_DEFECTO) * 60_000;
    const hueco = proximoHueco({
      desde: new Date(t + ESPERA_MINIMA_MIN * 60_000),
      zona: p.zona,
      ventanas: p.ventanas,
      duracionMin: s.target_minutes ?? DURACION_POR_DEFECTO,
      ocupadas: [
        ...pendientes
          .filter((o) => o.id !== s.id)
          .map((o) => ({
            inicio: new Date(o.scheduled_at as string),
            fin: new Date(new Date(o.scheduled_at as string).getTime() + duracionDe(o)),
          })),
        // Tampoco encima de una llamada de rutina de hoy que todavía no se creó,
        // ni de las que este mismo cálculo acaba de reprogramar.
        ...acciones.flatMap((a) =>
          a.tipo === "crear"
            ? [{ inicio: new Date(a.cuando), fin: new Date(new Date(a.cuando).getTime() + a.rutina.target_minutes * 60_000) }]
            : a.tipo === "reprogramar"
              ? [{ inicio: new Date(a.cuando), fin: new Date(new Date(a.cuando).getTime() + duracionDe(a.sesion)) }]
              : [],
        ),
      ],
    });
    acciones.push(hueco ? { tipo: "reprogramar", sesion: s, cuando: hueco.toISOString() } : { tipo: "perder", sesion: s });
  }
  return acciones;
}

/** "hoy a las 18:30", "mañana a las 9:00", "el jueves 14 a las 9:00". */
export function cuandoLegible(instante: Date, zona: string, ahora: Date): string {
  const p = partesEnZona(instante, zona);
  const hoy = partesEnZona(ahora, zona).fecha;
  const hora = p.hora.replace(/^0/, "");
  if (p.fecha === hoy) return `hoy a las ${hora}`;
  if (p.fecha === sumarDias(hoy, 1)) return `mañana a las ${hora}`;
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `el ${DIAS[p.diaSemana]} ${Number(p.fecha.slice(8))} a las ${hora}`;
}
