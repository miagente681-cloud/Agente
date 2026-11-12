import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AJUSTES_POR_DEFECTO, ajustesDe, cuandoLegible, decidir, instanteLocal, partesEnZona, proximoHueco,
  type RutinaP, type SesionP, type Ventana,
} from "@/lib/programacion/horarios";
import { correrTick, type CargaPush, type EnviarPush } from "@/lib/programacion/tick";
import { levantarSupabase, type ServidorSupabase } from "./apoyo/falsos";

const MVD = "America/Montevideo"; // UTC-3 todo el año
const NY = "America/New_York"; // con cambio de hora
const z = (iso: string) => new Date(iso);

describe("horas locales y zonas", () => {
  it("convierte una hora de reloj a su instante", () => {
    expect(instanteLocal("2026-11-10", "09:00", MVD).toISOString()).toBe("2026-11-10T12:00:00.000Z");
    expect(instanteLocal("2026-07-01", "08:00", "Europe/Madrid").toISOString()).toBe("2026-07-01T06:00:00.000Z");
    expect(instanteLocal("2026-01-15", "08:00", "Europe/Madrid").toISOString()).toBe("2026-01-15T07:00:00.000Z");
    // Pasada la medianoche local, el día en UTC ya es otro.
    expect(instanteLocal("2026-11-10", "23:45", MVD).toISOString()).toBe("2026-11-11T02:45:00.000Z");
  });

  it("respeta el cambio de hora (la misma hora de reloj cae en otro instante)", () => {
    // En Nueva York el horario de verano de 2026 empieza el 8 de marzo y termina el 1 de noviembre.
    expect(instanteLocal("2026-03-07", "09:00", NY).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(instanteLocal("2026-03-09", "09:00", NY).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(instanteLocal("2026-10-31", "09:00", NY).toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(instanteLocal("2026-11-02", "09:00", NY).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    // 02:30 del 8 de marzo no existe en Nueva York: no rompe y cae cerca.
    const fantasma = instanteLocal("2026-03-08", "02:30", NY).getTime();
    expect(Math.abs(fantasma - z("2026-03-08T07:00:00Z").getTime())).toBeLessThanOrEqual(3_600_000);
  });

  it("lee fecha, hora y día de la semana en la zona del perfil", () => {
    expect(partesEnZona(z("2026-11-11T02:30:00Z"), MVD)).toMatchObject({ fecha: "2026-11-10", hora: "23:30", diaSemana: 2, minutos: 1410 });
    expect(partesEnZona(z("2026-11-11T02:30:00Z"), "Asia/Tokyo")).toMatchObject({ fecha: "2026-11-11", hora: "11:30", diaSemana: 3 });
    expect(partesEnZona(z("2026-11-10T03:00:00Z"), MVD).hora).toBe("00:00"); // medianoche es 00, no 24
  });

  it("dice los horarios como se dicen hablando", () => {
    const ahora = z("2026-11-10T15:00:00Z");
    expect(cuandoLegible(z("2026-11-10T21:30:00Z"), MVD, ahora)).toBe("hoy a las 18:30");
    expect(cuandoLegible(z("2026-11-11T12:00:00Z"), MVD, ahora)).toBe("mañana a las 9:00");
    expect(cuandoLegible(z("2026-11-13T12:05:00Z"), MVD, ahora)).toBe("el viernes 13 a las 9:05");
  });

  it("lee los ajustes del perfil con límites sanos", () => {
    expect(ajustesDe(null)).toEqual(AJUSTES_POR_DEFECTO);
    expect(ajustesDe({ margen_minutos: 25, max_reprogramaciones: 0 })).toEqual({ margenMinutos: 25, maxReprogramaciones: 0 });
    expect(ajustesDe({ margen_minutos: -5, max_reprogramaciones: "muchas" })).toEqual({ margenMinutos: 1, maxReprogramaciones: 2 });
  });
});

const rutina = (r: Partial<RutinaP> & { id: string }): RutinaP => ({
  name: "Repaso", weekdays: [1, 2, 3, 4, 5], local_time: "09:00:00", target_minutes: 10, focus: null, active: true, ...r,
});
const sesion = (s: Partial<SesionP> & { id: string }): SesionP => ({
  status: "programada", routine_id: null, rescheduled_from: null, scheduled_at: null, notified_at: null,
  reschedule_count: 0, target_minutes: 10, ...s,
});
const base = { zona: MVD, rutinas: [] as RutinaP[], ventanas: [] as Ventana[], sesiones: [] as SesionP[], ajustes: AJUSTES_POR_DEFECTO };

describe("crear las llamadas del día", () => {
  it("usa el día de la semana local, no el de UTC", () => {
    // Martes 10 a las 23:30 en Montevideo; en UTC ya es miércoles 11.
    const ahora = z("2026-11-11T02:30:00Z");
    const acciones = decidir({
      ...base, ahora,
      rutinas: [
        rutina({ id: "martes-noche", weekdays: [2], local_time: "23:45" }),
        rutina({ id: "miercoles", weekdays: [3], local_time: "08:00" }),
        rutina({ id: "martes-manana", weekdays: [2], local_time: "09:00" }), // ya pasó hace horas
        rutina({ id: "pausada", weekdays: [2], local_time: "23:50", active: false }),
      ],
    });
    expect(acciones).toEqual([{ tipo: "crear", rutina: expect.objectContaining({ id: "martes-noche" }), cuando: "2026-11-11T02:45:00.000Z" }]);

    // Un minuto después de la medianoche local ya toca la del miércoles.
    const despues = decidir({ ...base, ahora: z("2026-11-11T03:01:00Z"), rutinas: [rutina({ id: "miercoles", weekdays: [3], local_time: "08:00" })] });
    expect(despues).toEqual([{ tipo: "crear", rutina: expect.objectContaining({ id: "miercoles" }), cuando: "2026-11-11T11:00:00.000Z" }]);
  });

  it("no duplica la de hoy, y una reprogramada desde ayer no impide la de hoy", () => {
    const ahora = z("2026-11-10T11:00:00Z");
    const r = rutina({ id: "r1" });
    const yaCreada = sesion({ id: "s1", routine_id: "r1", scheduled_at: "2026-11-10T12:00:00.000Z" });
    expect(decidir({ ...base, ahora, rutinas: [r], sesiones: [yaCreada] })).toEqual([]);
    // Aunque ya se haya atendido o perdido, sigue contando como la de hoy.
    expect(decidir({ ...base, ahora, rutinas: [r], sesiones: [{ ...yaCreada, status: "completada" }] })).toEqual([]);
    const deAyer = sesion({ id: "s0", routine_id: "r1", rescheduled_from: "x", scheduled_at: "2026-11-10T13:00:00.000Z" });
    expect(decidir({ ...base, ahora, rutinas: [r], sesiones: [deAyer] }).map((a) => a.tipo)).toEqual(["crear"]);
  });

  it("una rutina creada con la hora recién pasada (dentro del margen) todavía se crea", () => {
    const acciones = decidir({ ...base, ahora: z("2026-11-10T12:05:00Z"), rutinas: [rutina({ id: "r1" })] });
    expect(acciones.map((a) => a.tipo)).toEqual(["crear"]);
    expect(decidir({ ...base, ahora: z("2026-11-10T12:11:00Z"), rutinas: [rutina({ id: "r1" })] })).toEqual([]);
  });
});

describe("avisar y reprogramar", () => {
  const ventanas: Ventana[] = [
    { weekday: 2, start_time: "09:00:00", end_time: "10:00:00" },
    { weekday: 2, start_time: "18:00:00", end_time: "20:00:00" },
  ];
  const avisada = (extra: Partial<SesionP> = {}) =>
    sesion({ id: "s1", status: "notificada", scheduled_at: "2026-11-10T12:00:00.000Z", notified_at: "2026-11-10T12:00:00.000Z", ...extra });

  it("avisa cuando llega la hora, no antes", () => {
    const s = sesion({ id: "s1", scheduled_at: "2026-11-10T12:00:00.000Z" });
    expect(decidir({ ...base, ahora: z("2026-11-10T11:59:30Z"), sesiones: [s] })).toEqual([]);
    expect(decidir({ ...base, ahora: z("2026-11-10T12:00:10Z"), sesiones: [s] })).toEqual([{ tipo: "notificar", sesion: s }]);
  });

  it("espera el margen y después reprograma al próximo hueco dentro de la disponibilidad", () => {
    expect(decidir({ ...base, ventanas, ahora: z("2026-11-10T12:09:00Z"), sesiones: [avisada()] })).toEqual([]);
    // 09:10 local: con media hora de espera mínima cae a las 09:40, dentro de la ventana de la mañana.
    expect(decidir({ ...base, ventanas, ahora: z("2026-11-10T12:10:00Z"), sesiones: [avisada()] })).toEqual([
      { tipo: "reprogramar", sesion: avisada(), cuando: "2026-11-10T12:40:00.000Z" },
    ]);
    // Con un margen más largo, espera más.
    expect(decidir({ ...base, ventanas, ajustes: { margenMinutos: 20, maxReprogramaciones: 2 }, ahora: z("2026-11-10T12:15:00Z"), sesiones: [avisada()] })).toEqual([]);
  });

  it("si la llamada no entra en lo que queda de la ventana, va a la siguiente", () => {
    const larga = avisada({ target_minutes: 30 }); // 09:40 + 30 min se pasa de las 10:00
    const [accion] = decidir({ ...base, ventanas, ahora: z("2026-11-10T12:10:00Z"), sesiones: [larga] });
    expect(accion).toMatchObject({ tipo: "reprogramar", cuando: "2026-11-10T21:00:00.000Z" }); // 18:00 local
  });

  it("no pisa otra llamada ya programada", () => {
    const otra = sesion({ id: "s2", scheduled_at: "2026-11-10T21:00:00.000Z", target_minutes: 15 });
    const [accion] = decidir({ ...base, ventanas, ahora: z("2026-11-10T12:10:00Z"), sesiones: [avisada({ target_minutes: 30 }), otra] });
    expect(accion).toMatchObject({ tipo: "reprogramar", cuando: "2026-11-10T21:15:00.000Z" });
  });

  it("si hoy ya no hay ventana, pasa al próximo día con disponibilidad (cambio de día)", () => {
    // 20:00 local del martes: las dos ventanas de hoy ya cerraron. La próxima es el martes que viene.
    const tarde = avisada({ scheduled_at: "2026-11-10T22:50:00.000Z", notified_at: "2026-11-10T22:50:00.000Z" });
    const [accion] = decidir({ ...base, ventanas, ahora: z("2026-11-10T23:00:00Z"), sesiones: [tarde] });
    expect(accion).toMatchObject({ tipo: "reprogramar", cuando: "2026-11-17T12:00:00.000Z" });
  });

  it("sin ventanas cargadas usa de 8 a 22, y de noche pasa a la mañana siguiente", () => {
    expect(decidir({ ...base, ahora: z("2026-11-10T12:10:00Z"), sesiones: [avisada()] })[0]).toMatchObject({ cuando: "2026-11-10T12:40:00.000Z" });
    const noche = avisada({ scheduled_at: "2026-11-11T00:50:00.000Z", notified_at: "2026-11-11T00:50:00.000Z" });
    // 22:00 local del martes → 08:00 del miércoles.
    expect(decidir({ ...base, ahora: z("2026-11-11T01:00:00Z"), sesiones: [noche] })[0]).toMatchObject({ cuando: "2026-11-11T11:00:00.000Z" });
  });

  it("tras el máximo de reprogramaciones la da por perdida; sin hueco en una semana, también", () => {
    expect(decidir({ ...base, ahora: z("2026-11-10T12:10:00Z"), sesiones: [avisada({ reschedule_count: 2 })] })).toEqual([
      { tipo: "perder", sesion: avisada({ reschedule_count: 2 }) },
    ]);
    expect(decidir({ ...base, ajustes: { margenMinutos: 10, maxReprogramaciones: 0 }, ahora: z("2026-11-10T12:10:00Z"), sesiones: [avisada()] })[0].tipo).toBe("perder");
    // Una ventana tan corta que la llamada no entra nunca.
    const imposible: Ventana[] = [{ weekday: 4, start_time: "09:00", end_time: "09:05" }];
    expect(decidir({ ...base, ventanas: imposible, ahora: z("2026-11-10T12:10:00Z"), sesiones: [avisada()] })[0].tipo).toBe("perder");
  });

  it("una llamada atendida no se toca", () => {
    expect(decidir({ ...base, ahora: z("2026-11-10T13:00:00Z"), sesiones: [avisada({ status: "en_curso" })] })).toEqual([]);
  });

  it("dos llamadas ignoradas a la vez no se reprograman al mismo hueco", () => {
    const a = avisada({ id: "a" });
    const b = avisada({ id: "b" });
    const cuando = decidir({ ...base, ahora: z("2026-11-10T12:10:00Z"), sesiones: [a, b] }).map((x) => (x.tipo === "reprogramar" ? x.cuando : null));
    expect(cuando).toEqual(["2026-11-10T12:40:00.000Z", "2026-11-10T12:50:00.000Z"]);
  });

  it("el hueco respeta el cambio de hora de la zona", () => {
    // Sábado 7 de marzo a las 21:50 en Nueva York: mañana empieza el horario de verano.
    const hueco = proximoHueco({
      desde: z("2026-03-08T02:50:00Z"), zona: NY, duracionMin: 10, ocupadas: [],
      ventanas: [{ weekday: 0, start_time: "09:00", end_time: "10:00" }],
    });
    expect(hueco?.toISOString()).toBe("2026-03-08T13:00:00.000Z"); // 09:00 ya en horario de verano (UTC-4)
  });
});

describe("el programador, minuto a minuto", () => {
  let servidor: ServidorSupabase;
  let admin: SupabaseClient;
  let enviados: { endpoint: string; carga: CargaPush }[];
  const enviar: EnviarPush = async (s, carga) => {
    if (s.endpoint.includes("vencida")) return "vencida";
    enviados.push({ endpoint: s.endpoint, carga });
    return "ok";
  };
  const tick = (iso: string, conPush = true) => correrTick({ admin, ahora: z(iso), enviar: conPush ? enviar : null });
  const sesiones = () => servidor.estado().sessions;

  beforeAll(async () => {
    ({ servidor, sb: admin } = await levantarSupabase());
  });
  afterAll(() => servidor.close());
  beforeEach(() => {
    servidor.reiniciar();
    enviados = [];
    servidor.sembrar("call_routines", { name: "Repaso matutino", weekdays: [2], local_time: "09:00:00", target_minutes: 10, focus: "Repaso breve del día" });
    servidor.sembrar("push_subscriptions", { endpoint: "https://fcm.googleapis.com/fcm/send/celular", p256dh: "p", auth: "a" });
    servidor.sembrar("push_subscriptions", { endpoint: "https://fcm.googleapis.com/fcm/send/vencida", p256dh: "p", auth: "a" });
  });

  it("crea la llamada, avisa a la hora, reprograma dos veces y al final la da por perdida", async () => {
    expect(await tick("2026-11-10T11:00:00Z")).toMatchObject({ creadas: 1, notificadas: 0 });
    expect(await tick("2026-11-10T11:01:00Z")).toMatchObject({ creadas: 0 }); // no duplica
    expect(sesiones()).toHaveLength(1);
    expect(sesiones()[0]).toMatchObject({
      kind: "llamada_programada", channel: "voz", status: "programada",
      scheduled_at: "2026-11-10T12:00:00.000Z", focus: "Repaso breve del día", target_minutes: 10,
    });
    const primera = sesiones()[0].id;

    expect(await tick("2026-11-10T12:00:20Z")).toMatchObject({ notificadas: 1, avisos: 1 });
    expect(sesiones()[0]).toMatchObject({ status: "notificada", notified_at: "2026-11-10T12:00:20.000Z" });
    expect(enviados[0]).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/celular",
      carga: { titulo: "Tu Agente te está llamando", cuerpo: "Repaso breve del día", url: `/llamada/${primera}`, etiqueta: `llamada-${primera}`, persistente: true },
    });
    // La suscripción que el navegador dio de baja se borra sola.
    expect(servidor.estado().push_subscriptions.map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/celular"]);

    expect(await tick("2026-11-10T12:05:00Z")).toMatchObject({ reprogramadas: 0, notificadas: 0 });
    expect(await tick("2026-11-10T12:10:30Z")).toMatchObject({ reprogramadas: 1 });
    expect(sesiones()[0].status).toBe("reprogramada");
    expect(sesiones()[1]).toMatchObject({
      status: "programada", rescheduled_from: primera, reschedule_count: 1,
      scheduled_at: "2026-11-10T12:45:00.000Z", focus: "Repaso breve del día",
    });
    expect(enviados[1].carga).toMatchObject({ titulo: "Reprogramé la llamada", cuerpo: "No atendiste, así que te la pasé para hoy a las 9:45." });

    expect(await tick("2026-11-10T12:45:10Z")).toMatchObject({ notificadas: 1, creadas: 0 });
    expect(await tick("2026-11-10T12:55:30Z")).toMatchObject({ reprogramadas: 1 });
    expect(sesiones()[2]).toMatchObject({ reschedule_count: 2, scheduled_at: "2026-11-10T13:30:00.000Z" });
    expect(await tick("2026-11-10T13:30:05Z")).toMatchObject({ notificadas: 1 });
    expect(await tick("2026-11-10T13:40:10Z")).toMatchObject({ perdidas: 1, reprogramadas: 0 });
    expect(sesiones().map((s) => s.status)).toEqual(["reprogramada", "reprogramada", "perdida"]);
    expect(enviados.at(-1)?.carga.titulo).toBe("Se perdió la llamada");
    // Y no vuelve a crear la de hoy.
    expect(await tick("2026-11-10T13:41:00Z")).toMatchObject({ creadas: 0, perdidas: 0 });
  });

  it("si atiendo la llamada, no la reprograma; si queda abierta horas, la cierra", async () => {
    await tick("2026-11-10T11:00:00Z");
    await tick("2026-11-10T12:00:20Z");
    Object.assign(sesiones()[0], { status: "en_curso", started_at: "2026-11-10T12:02:00.000Z" });
    expect(await tick("2026-11-10T12:30:00Z")).toMatchObject({ reprogramadas: 0, perdidas: 0, cerradas: 0 });
    expect(sesiones()[0].status).toBe("en_curso");
    expect(await tick("2026-11-10T15:30:00Z")).toMatchObject({ cerradas: 1 });
    expect(sesiones()[0]).toMatchObject({ status: "completada", ended_at: "2026-11-10T15:30:00.000Z" });
  });

  it("sin claves de push hace todo igual, solo que sin avisar al teléfono", async () => {
    await tick("2026-11-10T11:00:00Z", false);
    expect(await tick("2026-11-10T12:00:20Z", false)).toMatchObject({ notificadas: 1, avisos: 0 });
    expect(sesiones()[0].status).toBe("notificada");
    expect(enviados).toEqual([]);
  });

  it("respeta el margen y el máximo que cada persona eligió, y su disponibilidad", async () => {
    servidor.estado().profiles[0].agent_config = { margen_minutos: 20, max_reprogramaciones: 1 };
    servidor.sembrar("availability_windows", { weekday: 2, start_time: "18:00:00", end_time: "20:00:00" });
    await tick("2026-11-10T11:00:00Z");
    await tick("2026-11-10T12:00:00Z");
    expect(await tick("2026-11-10T12:15:00Z")).toMatchObject({ reprogramadas: 0 });
    expect(await tick("2026-11-10T12:20:00Z")).toMatchObject({ reprogramadas: 1 });
    expect(sesiones()[1].scheduled_at).toBe("2026-11-10T21:00:00.000Z"); // 18:00 local, su única ventana
    await tick("2026-11-10T21:00:00Z");
    expect(await tick("2026-11-10T21:20:00Z")).toMatchObject({ perdidas: 1 });
  });

  it("no manda a destinos que no son servicios de push, y una corrida no se demora por un destino lento", async () => {
    // Una fila vieja (anterior a la restricción de la base) con un destino cualquiera.
    servidor.sembrar("push_subscriptions", { endpoint: "http://169.254.169.254/latest/meta-data", p256dh: "p", auth: "a" });
    servidor.sembrar("push_subscriptions", { endpoint: "https://evil.example.com/x", p256dh: "p", auth: "a" });
    await tick("2026-11-10T11:00:00Z");
    expect(await tick("2026-11-10T12:00:20Z")).toMatchObject({ notificadas: 1, avisos: 1 });
    expect(enviados.map((e) => e.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/celular"]);

    // Con el tiempo de envíos de la corrida agotado, lo que falta se descarta y el programador sigue.
    let ahora = 0;
    const lento: EnviarPush = async (s, carga) => {
      ahora += 30_000; // cada envío "tarda" 30 s
      enviados.push({ endpoint: s.endpoint, carga });
      return "ok";
    };
    servidor.sembrar("push_subscriptions", { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/otro", p256dh: "p", auth: "a" });
    const r = await correrTick({ admin, ahora: z("2026-11-10T12:10:30Z"), enviar: lento, tiempoEnviosMs: 20_000, reloj: () => ahora });
    expect(r).toMatchObject({ reprogramadas: 1 });
    expect(r.avisos + r.postergados).toBe(2);
    expect(r.postergados).toBeGreaterThanOrEqual(1);
  });

  it("manda cada recordatorio a su hora, en sus días, una sola vez por día", async () => {
    // Martes 10/11; 20:00 en Montevideo son las 23:00 UTC.
    servidor.sembrar("reminders", { message: "Entrá a documentar tu día.", weekdays: [2, 4], local_time: "20:00:00" });
    servidor.sembrar("reminders", { message: "Solo los lunes", weekdays: [1], local_time: "20:00:00" });
    servidor.sembrar("reminders", { message: "Apagado", weekdays: [2], local_time: "20:00:00", active: false });
    expect(await tick("2026-11-10T22:59:00Z")).toMatchObject({ recordatorios: 0 });
    expect(await tick("2026-11-10T23:00:10Z")).toMatchObject({ recordatorios: 1 });
    const recordatorio = enviados.find((e) => e.carga.cuerpo === "Entrá a documentar tu día.");
    expect(recordatorio?.carga).toMatchObject({ titulo: "MiAgente", url: "/chat" });
    expect(await tick("2026-11-10T23:01:00Z")).toMatchObject({ recordatorios: 0 }); // no repite
    expect(await tick("2026-11-11T23:00:10Z")).toMatchObject({ recordatorios: 0 }); // miércoles: no toca
    expect(await tick("2026-11-12T23:00:10Z")).toMatchObject({ recordatorios: 1 }); // jueves
    expect(enviados.filter((e) => e.carga.etiqueta.startsWith("recordatorio-"))).toHaveLength(2);
    // Si el programador estuvo caído más de una hora, el de ese día ya no se manda.
    servidor.sembrar("reminders", { message: "Viejo", weekdays: [4], local_time: "08:00:00" });
    expect(await tick("2026-11-12T23:30:00Z")).toMatchObject({ recordatorios: 0 });
  });
});
