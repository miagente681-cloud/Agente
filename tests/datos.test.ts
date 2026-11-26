import { describe, expect, it } from "vitest";
import {
  diaSemana, diferenciaDias, domingoDe, etiquetaFecha, fechaEnZona, fechaValida,
  grillaMes, lunesDe, sumarDias,
} from "@/lib/datos/fechas";
import { diaDeTarea, llamadasDelDia, tareasDelDia, type RutinaConId, type SesionDelDia } from "@/lib/datos/dia";
import { ordenEnPosicion, ordenEntre } from "@/lib/datos/orden";
import { parsearTarea } from "@/lib/datos/parsear-tarea";
import type { Tarea } from "@/lib/datos/tipos";

describe("fechas", () => {
  it("el día depende de la zona del perfil, no de UTC", () => {
    // 02:30 UTC del 11 todavía es el 10 en Montevideo (UTC-3) y ya es el 11 en Madrid.
    const instante = new Date("2026-11-11T02:30:00Z");
    expect(fechaEnZona(instante, "America/Montevideo")).toBe("2026-11-10");
    expect(fechaEnZona(instante, "Europe/Madrid")).toBe("2026-11-11");
  });

  it("una zona inválida no rompe", () => {
    expect(fechaEnZona(new Date(), "No/Existe")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("suma días cruzando mes, año y febrero bisiesto", () => {
    expect(sumarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(diferenciaDias("2026-11-10", "2026-11-17")).toBe(7);
    expect(diferenciaDias("2026-11-10", "2026-11-08")).toBe(-2);
  });

  it("la semana va de lunes a domingo", () => {
    expect(diaSemana("2026-11-10")).toBe(2); // martes
    expect(lunesDe("2026-11-10")).toBe("2026-11-09");
    expect(domingoDe("2026-11-10")).toBe("2026-11-15");
    expect(lunesDe("2026-11-15")).toBe("2026-11-09"); // el domingo cierra la semana
    expect(lunesDe("2026-11-09")).toBe("2026-11-09");
  });

  it("etiquetas de fecha", () => {
    const hoy = "2026-11-10";
    expect(etiquetaFecha("2026-11-10", hoy)).toBe("Hoy");
    expect(etiquetaFecha("2026-11-11", hoy)).toBe("Mañana");
    expect(etiquetaFecha("2026-11-09", hoy)).toBe("Ayer");
    expect(etiquetaFecha("2026-11-13", hoy)).toBe("vie 13");
    expect(etiquetaFecha("2026-12-24", hoy)).toBe("24 dic");
    expect(etiquetaFecha("2027-01-05", hoy)).toBe("5 ene 2027");
    expect(etiquetaFecha("2026-11-02", hoy)).toBe("2 nov");
  });

  it("la grilla del mes tiene 42 días, empieza en lunes y contiene el mes entero", () => {
    const g = grillaMes(2026, 11);
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-10-26");
    expect(diaSemana(g[0])).toBe(1);
    expect(g).toContain("2026-11-01");
    expect(g).toContain("2026-11-30");
  });

  it("rechaza fechas que no existen", () => {
    expect(fechaValida(2026, 2, 31)).toBeNull();
    expect(fechaValida(2028, 2, 29)).toBe("2028-02-29");
  });
});

describe("orden", () => {
  it("punto medio entre vecinos, y extremos", () => {
    expect(ordenEntre(1, 2)).toBe(1.5);
    expect(ordenEntre(null, 5)).toBe(4);
    expect(ordenEntre(5, null)).toBe(6);
  });

  it("inserta en una posición sin contar al propio elemento", () => {
    const lista = [
      { id: "a", sort_order: 1 }, { id: "b", sort_order: 2 }, { id: "c", sort_order: 3 },
    ];
    expect(ordenEnPosicion(lista, "x", 0)).toBe(0);
    expect(ordenEnPosicion(lista, "x", 1)).toBe(1.5);
    expect(ordenEnPosicion(lista, "x", 99)).toBe(4);
    // Mover "a" al final: queda después de "c".
    expect(ordenEnPosicion(lista, "a", 2)).toBe(4);
    // Mover "c" al medio: entre "a" y "b".
    expect(ordenEnPosicion(lista, "c", 1)).toBe(1.5);
  });
});

describe("alta de tarea en una línea", () => {
  const hoy = "2026-11-10"; // martes

  it("sin marcas, todo es título", () => {
    expect(parsearTarea("  Comprar pintura  ", hoy)).toEqual({
      titulo: "Comprar pintura", due_date: null, priority: null, plan_hora: null,
    });
  });

  it("lee fecha y prioridad al final, en cualquier orden", () => {
    expect(parsearTarea("Pintar el cuarto vie p1", hoy)).toEqual({
      titulo: "Pintar el cuarto", due_date: "2026-11-13", priority: 1, plan_hora: null,
    });
    expect(parsearTarea("Pintar el cuarto P3 mañana", hoy)).toEqual({
      titulo: "Pintar el cuarto", due_date: "2026-11-11", priority: 3, plan_hora: null,
    });
  });

  it("no se come palabras del medio del título", () => {
    expect(parsearTarea("Preparar la reunión de mañana con Ana", hoy).titulo).toBe(
      "Preparar la reunión de mañana con Ana",
    );
    expect(parsearTarea("Preparar la reunión de mañana con Ana", hoy).due_date).toBeNull();
  });

  it("el día de la semana es el próximo, nunca hoy", () => {
    expect(parsearTarea("Gimnasio martes", hoy).due_date).toBe("2026-11-17");
    expect(parsearTarea("Gimnasio miércoles", hoy).due_date).toBe("2026-11-11");
    expect(parsearTarea("Gimnasio sáb", hoy).due_date).toBe("2026-11-14");
  });

  it("fechas con barra: este año, o el que viene si ya pasó", () => {
    expect(parsearTarea("Renovar cédula 14/11", hoy).due_date).toBe("2026-11-14");
    expect(parsearTarea("Renovar cédula 5/3", hoy).due_date).toBe("2027-03-05");
    expect(parsearTarea("Renovar cédula 5/3/2028", hoy).due_date).toBe("2028-03-05");
  });

  it("una fecha imposible queda en el título", () => {
    expect(parsearTarea("Algo 31/2", hoy)).toEqual({ titulo: "Algo 31/2", due_date: null, priority: null, plan_hora: null });
  });

  it("lee la hora en que la vas a hacer", () => {
    expect(parsearTarea("Llamar al electricista mañana a las 10", hoy)).toEqual({
      titulo: "Llamar al electricista", due_date: "2026-11-11", priority: null, plan_hora: "10:00",
    });
    expect(parsearTarea("Pagar la luz 18:30", hoy)).toMatchObject({ titulo: "Pagar la luz", plan_hora: "18:30" });
    expect(parsearTarea("Gimnasio 7hs p2", hoy)).toMatchObject({ titulo: "Gimnasio", plan_hora: "07:00", priority: 2 });
    expect(parsearTarea("Reunión con Ana de las 9:15 vie", hoy)).toMatchObject({
      titulo: "Reunión con Ana", plan_hora: "09:15", due_date: "2026-11-13",
    });
    expect(parsearTarea("Dentista a la 1", hoy)).toMatchObject({ titulo: "Dentista", plan_hora: "01:00" });
  });

  it("un número solo no es hora, salvo después de «a las»", () => {
    expect(parsearTarea("Comprar huevos 12", hoy)).toMatchObject({ titulo: "Comprar huevos 12", plan_hora: null });
    expect(parsearTarea("Repasar la clase de las 10", hoy)).toMatchObject({ titulo: "Repasar la clase de las 10", plan_hora: null });
    expect(parsearTarea("Algo 25:00", hoy)).toMatchObject({ titulo: "Algo 25:00", plan_hora: null });
    expect(parsearTarea("a las 10", hoy)).toMatchObject({ titulo: "a las 10", plan_hora: null });
  });

  it("una sola palabra nunca se interpreta como marca", () => {
    expect(parsearTarea("mañana", hoy)).toEqual({ titulo: "mañana", due_date: null, priority: null, plan_hora: null });
  });
});

describe("un día de la tira de Hoy", () => {
  const ZONA = "America/Montevideo";
  const HOY = "2026-11-26"; // jueves
  const tarea = (t: Partial<Tarea> & { id: string }): Tarea =>
    ({
      title: t.id,
      status: "pendiente",
      due_date: null,
      plan_fecha: null,
      plan_hora: null,
      completed_at: null,
      ...t,
    }) as Tarea;

  it("cada tarea cae el día que la hacés; si no lo elegiste, el de su fecha límite", () => {
    const tareas = [
      tarea({ id: "vence-vie", due_date: "2026-11-27" }),
      tarea({ id: "hago-mie-vence-vie", plan_fecha: "2026-11-25", due_date: "2026-11-27" }),
      tarea({ id: "sin-fecha" }),
    ];
    expect(diaDeTarea(tareas[1])).toBe("2026-11-25");
    expect(tareasDelDia(tareas, "2026-11-27", ZONA).pendientes.map((t) => t.id)).toEqual(["vence-vie"]);
    expect(tareasDelDia(tareas, "2026-11-25", ZONA).pendientes.map((t) => t.id)).toEqual(["hago-mie-vence-vie"]);
  });

  it("lo hecho cuenta el día en que se hizo, en la zona del perfil", () => {
    const tareas = [
      // 01:30 UTC del 25 todavía es el 24 en Montevideo.
      tarea({ id: "noche", status: "hecha", completed_at: "2026-11-25T01:30:00Z", due_date: "2026-11-25" }),
      tarea({ id: "tarde", status: "hecha", completed_at: "2026-11-25T18:00:00Z" }),
    ];
    expect(tareasDelDia(tareas, "2026-11-24", ZONA).hechas.map((t) => t.id)).toEqual(["noche"]);
    expect(tareasDelDia(tareas, "2026-11-25", ZONA).hechas.map((t) => t.id)).toEqual(["tarde"]);
    // Hecha, ya no está pendiente en su fecha límite.
    expect(tareasDelDia(tareas, "2026-11-25", ZONA).pendientes).toEqual([]);
  });

  const rutina: RutinaConId = { id: "r1", weekdays: [1, 2, 3, 4, 5], local_time: "16:30:00", focus: "Repaso", active: true };

  it("un día que viene muestra las llamadas que van a salir de las rutinas", () => {
    expect(llamadasDelDia([], [rutina], "2026-11-27", HOY, ZONA)).toEqual([
      { id: null, hora: "16:30", foco: "Repaso", estado: "programada" },
    ]);
    // El sábado la rutina no llama, y una rutina apagada tampoco.
    expect(llamadasDelDia([], [rutina], "2026-11-28", HOY, ZONA)).toEqual([]);
    expect(llamadasDelDia([], [{ ...rutina, active: false }], "2026-11-27", HOY, ZONA)).toEqual([]);
  });

  it("un día que pasó muestra solo las llamadas que existieron, con cómo terminaron", () => {
    const sesiones: SesionDelDia[] = [
      { id: "s1", status: "perdida", scheduled_at: "2026-11-24T19:30:00Z", focus: "Repaso", routine_id: "r1" },
      { id: "s2", status: "reprogramada", scheduled_at: "2026-11-24T19:00:00Z", focus: null, routine_id: "r1" },
      { id: "s3", status: "completada", scheduled_at: "2026-11-25T19:30:00Z", focus: null, routine_id: "r1" },
    ];
    // 19:30 UTC son las 16:30 en Montevideo. La reprogramada no se cuenta: reaparece en su horario nuevo.
    expect(llamadasDelDia(sesiones, [rutina], "2026-11-24", HOY, ZONA)).toEqual([
      { id: "s1", hora: "16:30", foco: "Repaso", estado: "perdida" },
    ]);
    expect(llamadasDelDia(sesiones, [rutina], "2026-11-25", HOY, ZONA)[0]?.estado).toBe("hecha");
  });

  it("si la llamada de una rutina ya existe ese día, no se repite", () => {
    const sesiones: SesionDelDia[] = [
      { id: "s4", status: "programada", scheduled_at: "2026-11-27T21:00:00Z", focus: "Repaso", routine_id: "r1" },
    ];
    expect(llamadasDelDia(sesiones, [rutina], "2026-11-27", HOY, ZONA)).toEqual([
      { id: "s4", hora: "18:00", foco: "Repaso", estado: "programada" },
    ]);
  });
});
