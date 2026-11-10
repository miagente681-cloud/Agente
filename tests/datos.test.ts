import { describe, expect, it } from "vitest";
import {
  diaSemana, diferenciaDias, domingoDe, etiquetaFecha, fechaEnZona, fechaValida,
  grillaMes, lunesDe, sumarDias,
} from "@/lib/datos/fechas";
import { ordenEnPosicion, ordenEntre } from "@/lib/datos/orden";
import { parsearTarea } from "@/lib/datos/parsear-tarea";

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
      titulo: "Comprar pintura", due_date: null, priority: null,
    });
  });

  it("lee fecha y prioridad al final, en cualquier orden", () => {
    expect(parsearTarea("Pintar el cuarto vie p1", hoy)).toEqual({
      titulo: "Pintar el cuarto", due_date: "2026-11-13", priority: 1,
    });
    expect(parsearTarea("Pintar el cuarto P3 mañana", hoy)).toEqual({
      titulo: "Pintar el cuarto", due_date: "2026-11-11", priority: 3,
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
    expect(parsearTarea("Algo 31/2", hoy)).toEqual({ titulo: "Algo 31/2", due_date: null, priority: null });
  });

  it("una sola palabra nunca se interpreta como marca", () => {
    expect(parsearTarea("mañana", hoy)).toEqual({ titulo: "mañana", due_date: null, priority: null });
  });
});
