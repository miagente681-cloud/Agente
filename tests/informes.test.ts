import { describe, expect, it } from "vitest";
import { leerBloque, leerBloques, tituloBloque } from "@/lib/informes/bloques";
import {
  calcularInforme, decirValor, grupoEfectivo, resumenInforme, tramos, type FuenteInforme, type TareaInforme,
} from "@/lib/informes/calcular";
import { DatosInforme, type BloqueGrafico, type BloqueLista, type BloqueNumero, type EspecInforme } from "@/lib/informes/tipos";

const MVD = "America/Montevideo"; // UTC-3

describe("cómo pide el Agente cada bloque", () => {
  const bien = (texto: string) => {
    const r = leerBloque(texto);
    if (!r.ok) throw new Error(r.error);
    return r.bloque;
  };
  const mal = (texto: string) => {
    const r = leerBloque(texto);
    return r.ok ? "" : r.error;
  };

  it("lee tipo, medidas y grupo", () => {
    expect(bien("numero hechas")).toEqual({ tipo: "numero", medidas: ["hechas"], agrupar: null });
    expect(bien("barras hechas,creadas por semana")).toEqual({ tipo: "barras", medidas: ["hechas", "creadas"], agrupar: "semana" });
    expect(bien("lineas puntualidad por mes")).toEqual({ tipo: "lineas", medidas: ["puntualidad"], agrupar: "mes" });
    expect(bien("lista tarde")).toEqual({ tipo: "lista", medidas: ["tarde"], agrupar: null });
  });

  it("tolera tildes, mayúsculas, espacios y otras formas de decirlo", () => {
    expect(bien("  Líneas  Hechas  por  Día ")).toEqual({ tipo: "lineas", medidas: ["hechas"], agrupar: "dia" });
    expect(bien("barras a tiempo, tarde por área")).toEqual({ tipo: "barras", medidas: ["a_tiempo", "tarde"], agrupar: "area" });
    // Una torta se muestra como reparto en barras ordenadas: se leen mejor.
    expect(bien("torta hechas por proyectos")).toEqual({ tipo: "reparto", medidas: ["hechas"], agrupar: "proyecto" });
    expect(bien("tabla hechas").tipo).toBe("lista");
  });

  it("explica qué está mal para que el modelo corrija", () => {
    expect(mal("hechas")).toMatch(/tipo medidas/);
    expect(mal("circulo hechas")).toMatch(/no es un tipo de bloque/);
    expect(mal("numero terminadas")).toMatch(/no es una medida.*hechas/);
    expect(mal("barras hechas por cliente")).toMatch(/no es un grupo/);
    expect(mal("barras hechas")).toMatch(/falta «por grupo»/);
    expect(mal("numero hechas por semana")).toMatch(/no lleva/);
    expect(mal("numero hechas,creadas")).toMatch(/una sola medida/);
    expect(mal("barras hechas,hechas por mes")).toMatch(/repetida/);
  });

  it("un solo eje por gráfico: un porcentaje no se mezcla con cantidades", () => {
    expect(mal("barras hechas,puntualidad por semana")).toMatch(/va sola/);
    expect(mal("lista puntualidad")).toMatch(/porcentaje o un promedio/);
    expect(mal("reparto atraso por proyecto")).toMatch(/porcentaje o un promedio/);
    expect(bien("barras puntualidad por proyecto").medidas).toEqual(["puntualidad"]);
  });

  it("dos medidas del mismo color no van juntas (no se distinguirían)", () => {
    expect(mal("barras hechas,a_tiempo por semana")).toMatch(/«hechas» y «a_tiempo» no van en el mismo gráfico/);
    expect(mal("barras tarde,vencidas por proyecto")).toMatch(/no van en el mismo gráfico/);
    expect(bien("barras hechas,tarde,pendientes por proyecto").medidas).toHaveLength(3);
  });

  it("cada forma con su eje: líneas en el tiempo, reparto y fotos por categoría", () => {
    expect(mal("lineas hechas por proyecto")).toMatch(/las líneas van por dia, semana o mes/);
    expect(mal("reparto hechas por mes")).toMatch(/el reparto va por proyecto/);
    expect(mal("barras pendientes por semana")).toMatch(/foto de hoy/);
    expect(mal("barras vencidas por dia")).toMatch(/foto de hoy/);
  });

  it("junta los errores de varios bloques", () => {
    const r = leerBloques(["numero hechas", "numero x", "barras hechas"]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/«x» no es una medida.*falta «por grupo»/);
    expect(leerBloques(["numero hechas", "lista hechas"])).toMatchObject({ ok: true });
  });

  it("arma el título de cada bloque", () => {
    expect(tituloBloque(bien("numero puntualidad"))).toBe("Puntualidad");
    expect(tituloBloque(bien("barras hechas por semana"))).toBe("Tareas hechas por semana");
    expect(tituloBloque(bien("barras hechas,creadas por mes"))).toBe("Tareas hechas y creadas por mes");
    expect(tituloBloque(bien("barras hechas,tarde,pendientes por area"))).toBe("Tareas hechas, hechas tarde y pendientes por área");
    expect(tituloBloque(bien("reparto hechas por proyecto"))).toBe("Tareas hechas: reparto por proyecto");
    expect(tituloBloque(bien("lista vencidas"))).toBe("Vencidas sin hacer");
  });
});

// --- Datos de prueba ---------------------------------------------------------------

let n = 0;
const tarea = (t: Partial<TareaInforme> & { title: string }): TareaInforme => ({
  id: `t${++n}`, project_id: "banio", parent_id: null, status: "pendiente", priority: 2, due_date: null,
  completed_at: null, created_at: "2026-10-01T12:00:00Z", archived_at: null, ...t,
});
/** Hecha tal día a las 10 de la mañana de Montevideo. */
const hecha = (title: string, dia: string, resto: Partial<TareaInforme> = {}) =>
  tarea({ title, status: "hecha", completed_at: `${dia}T13:00:00Z`, ...resto });

const fuente = (tareas: TareaInforme[]): FuenteInforme => ({
  tareas,
  proyectos: [
    { id: "banio", name: "Reformar el baño", area_id: "casa" },
    { id: "correr", name: "Correr 10 km", area_id: "salud" },
    { id: "suelto", name: "Varios", area_id: null },
  ],
  areas: [{ id: "casa", name: "Casa" }, { id: "salud", name: "Salud" }],
});

const espec = (bloques: string[], resto: Partial<EspecInforme> = {}): EspecInforme => {
  const leidos = leerBloques(bloques);
  if (!leidos.ok) throw new Error(leidos.error);
  return { titulo: "Prueba", desde: "2026-11-01", hasta: "2026-11-30", proyectoId: null, areaId: null, bloques: leidos.bloques, ...resto };
};
const HOY = { hoy: "2026-11-19", zona: MVD };
const calcular = (bloques: string[], tareas: TareaInforme[], resto: Partial<EspecInforme> = {}, c = HOY) =>
  calcularInforme(espec(bloques, resto), fuente(tareas), c);

describe("mediciones", () => {
  const tareas = () => [
    hecha("A tiempo, justo el día", "2026-11-10", { due_date: "2026-11-10" }),
    hecha("A tiempo, antes", "2026-11-12", { due_date: "2026-11-20", project_id: "correr" }),
    hecha("Tarde por 3 días", "2026-11-13", { due_date: "2026-11-10" }),
    hecha("Tarde por 1 día", "2026-11-05", { due_date: "2026-11-04", project_id: "correr", priority: 1 }),
    hecha("Sin fecha límite", "2026-11-14"),
    hecha("Del mes pasado", "2026-10-20", { due_date: "2026-10-25" }),
    hecha("Del mes pasado, tarde", "2026-10-28", { due_date: "2026-10-25" }),
    tarea({ title: "Vencida y sin hacer", due_date: "2026-11-15", created_at: "2026-11-02T15:00:00Z" }),
    tarea({ title: "Vence más adelante", due_date: "2026-11-25", status: "en_curso", created_at: "2026-11-03T15:00:00Z", project_id: "suelto" }),
    tarea({ title: "Vencida de octubre", due_date: "2026-10-30" }),
    tarea({ title: "Subtarea: no cuenta", parent_id: "t1", status: "hecha", completed_at: "2026-11-10T13:00:00Z" }),
    tarea({ title: "Archivada sin hacer", archived_at: "2026-11-11T00:00:00Z", due_date: "2026-11-01" }),
    hecha("Hecha y después archivada", "2026-11-18", { archived_at: "2026-11-19T00:00:00Z", due_date: "2026-11-30" }),
  ];

  it("cuenta hechas, a tiempo y tarde del período, y las compara con el anterior", () => {
    const d = calcular(["numero hechas", "numero a_tiempo", "numero tarde", "numero puntualidad", "numero atraso", "numero creadas"], tareas());
    const [hechas, aTiempo, tarde, puntualidad, atraso, creadas] = d.bloques as BloqueNumero[];
    // Cinco de noviembre más la que se archivó después de hacerla; la subtarea no cuenta.
    expect(hechas).toMatchObject({ titulo: "Tareas hechas", valor: 6, anterior: 2, unidad: "" });
    expect(aTiempo).toMatchObject({ valor: 3, anterior: 1 });
    expect(tarde).toMatchObject({ valor: 2, anterior: 1 });
    // 3 de las 5 que tenían fecha límite: la que no tiene fecha no entra.
    expect(puntualidad).toMatchObject({ valor: 60, anterior: 50, unidad: "%" });
    expect(atraso).toMatchObject({ valor: 2, anterior: 3, unidad: "días" });
    expect(creadas).toMatchObject({ valor: 2 });
    // El período anterior tiene el mismo largo y termina el día antes.
    expect(d.anterior).toEqual({ desde: "2026-10-02", hasta: "2026-10-31" });
    expect(DatosInforme.safeParse(d).success).toBe(true);
  });

  it("vencidas y pendientes son fotos de hoy: sin comparación, sin lo archivado ni lo hecho", () => {
    const d = calcular(["numero vencidas", "numero pendientes"], tareas());
    const [vencidas, pendientes] = d.bloques as BloqueNumero[];
    expect(vencidas).toMatchObject({ valor: 2, anterior: null }); // la del 15/11 y la de octubre
    expect(pendientes).toMatchObject({ valor: 3, anterior: null });
    // En el informe de octubre solo cuenta lo que ya estaba vencido al cerrar ese mes.
    const octubre = calcular(["numero vencidas"], tareas(), { desde: "2026-10-01", hasta: "2026-10-31" });
    expect((octubre.bloques[0] as BloqueNumero).valor).toBe(1);
  });

  it("sin tareas con fecha límite, la puntualidad no es cero: no hay dato", () => {
    const d = calcular(["numero puntualidad", "numero atraso", "numero hechas"], [hecha("Sola", "2026-11-03")]);
    expect((d.bloques as BloqueNumero[]).map((b) => b.valor)).toEqual([null, null, 1]);
    expect(resumenInforme(d)[0]).toBe("Puntualidad: —");
  });

  it("el día de una tarea es el de la persona, no el de UTC", () => {
    // 23:30 del 31 de octubre en Montevideo ya es 1 de noviembre en UTC.
    const borde = [tarea({ title: "De noche", status: "hecha", completed_at: "2026-11-01T02:30:00Z" })];
    expect((calcular(["numero hechas"], borde).bloques[0] as BloqueNumero).valor).toBe(0);
    expect((calcular(["numero hechas"], borde, {}, { hoy: "2026-11-19", zona: "UTC" }).bloques[0] as BloqueNumero).valor).toBe(1);
    const octubre = calcular(["numero hechas"], borde, { desde: "2026-10-01", hasta: "2026-10-31" });
    expect((octubre.bloques[0] as BloqueNumero).valor).toBe(1);
  });

  it("filtra por proyecto o por área", () => {
    const deCorrer = calcular(["numero hechas"], tareas(), { proyectoId: "correr" });
    expect(deCorrer.filtro).toBe("Proyecto: Correr 10 km");
    expect((deCorrer.bloques[0] as BloqueNumero).valor).toBe(2);
    const deCasa = calcular(["numero hechas"], tareas(), { areaId: "casa" });
    expect(deCasa.filtro).toBe("Área: Casa");
    expect((deCasa.bloques[0] as BloqueNumero).valor).toBe(4);
  });
});

describe("gráficos", () => {
  it("por semana: de lunes a domingo, recortadas al período", () => {
    const eje = tramos("semana", { desde: "2026-11-01", hasta: "2026-11-30" });
    // El 1/11/2026 es domingo: la primera «semana» es ese solo día.
    expect(eje[0]).toEqual({ etiqueta: "1 nov", rango: { desde: "2026-11-01", hasta: "2026-11-01" } });
    expect(eje[1]).toEqual({ etiqueta: "2 nov", rango: { desde: "2026-11-02", hasta: "2026-11-08" } });
    expect(eje.at(-1)).toEqual({ etiqueta: "30 nov", rango: { desde: "2026-11-30", hasta: "2026-11-30" } });
    expect(eje).toHaveLength(6);
  });

  it("por mes: cruza de año y nombra el año cuando hace falta", () => {
    const eje = tramos("mes", { desde: "2026-11-15", hasta: "2027-01-10" });
    expect(eje.map((t) => t.etiqueta)).toEqual(["nov 26", "dic 26", "ene 27"]);
    expect(eje[0].rango).toEqual({ desde: "2026-11-15", hasta: "2026-11-30" });
    expect(eje[2].rango).toEqual({ desde: "2027-01-01", hasta: "2027-01-10" });
    expect(tramos("mes", { desde: "2026-02-01", hasta: "2026-03-31" }).map((t) => t.rango.hasta)).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("si el período es largo, el eje pasa de días a semanas y de semanas a meses", () => {
    expect(grupoEfectivo("dia", { desde: "2026-11-01", hasta: "2026-11-30" })).toBe("dia");
    expect(grupoEfectivo("dia", { desde: "2026-09-01", hasta: "2026-11-30" })).toBe("semana");
    expect(grupoEfectivo("dia", { desde: "2026-01-01", hasta: "2026-12-31" })).toBe("mes");
    expect(grupoEfectivo("semana", { desde: "2026-01-01", hasta: "2026-12-31" })).toBe("mes");
    const d = calcular(["barras hechas por dia"], [], { desde: "2026-01-01", hasta: "2026-12-31" });
    expect(d.bloques[0]).toMatchObject({ agrupar: "mes", titulo: "Tareas hechas por mes" });
    expect((d.bloques[0] as BloqueGrafico).categorias).toHaveLength(12);
  });

  it("dos series en el tiempo comparten el mismo eje", () => {
    const tareas = [
      hecha("a", "2026-11-03", { created_at: "2026-11-02T15:00:00Z" }),
      hecha("b", "2026-11-04", { created_at: "2026-11-02T15:00:00Z" }),
      hecha("c", "2026-11-12", { created_at: "2026-11-10T15:00:00Z" }),
      tarea({ title: "d", created_at: "2026-11-17T15:00:00Z" }),
    ];
    const b = calcular(["lineas hechas,creadas por semana"], tareas).bloques[0] as BloqueGrafico;
    expect(b.categorias).toEqual(["1 nov", "2 nov", "9 nov", "16 nov", "23 nov", "30 nov"]);
    expect(b.series.map((s) => [s.medida, s.valores])).toEqual([
      ["hechas", [0, 2, 1, 0, 0, 0]],
      ["creadas", [0, 2, 1, 1, 0, 0]],
    ]);
    expect(b.titulo).toBe("Tareas hechas y creadas por semana");
  });

  it("por proyecto: ordenado de mayor a menor, sin los que no tienen nada", () => {
    const tareas = [
      hecha("a", "2026-11-03", { project_id: "correr" }),
      hecha("b", "2026-11-04", { project_id: "correr" }),
      hecha("c", "2026-11-05", { project_id: "banio" }),
      tarea({ title: "abierta", project_id: "suelto" }),
    ];
    const b = calcular(["reparto hechas por proyecto"], tareas).bloques[0] as BloqueGrafico;
    expect(b.categorias).toEqual(["Correr 10 km", "Reformar el baño"]);
    expect(b.series[0].valores).toEqual([2, 1]);
    const porArea = calcular(["barras pendientes por area"], tareas).bloques[0] as BloqueGrafico;
    expect(porArea.categorias).toEqual(["Sin área"]);
  });

  it("por prioridad respeta su orden, y la puntualidad por grupo muestra también el cero", () => {
    const tareas = [
      hecha("a", "2026-11-03", { priority: 3, due_date: "2026-11-01" }),
      hecha("b", "2026-11-04", { priority: 1, due_date: "2026-11-10" }),
      hecha("c", "2026-11-05", { priority: 1, due_date: "2026-11-10" }),
      hecha("d", "2026-11-05", { priority: 4 }),
    ];
    const b = calcular(["barras puntualidad por prioridad"], tareas).bloques[0] as BloqueGrafico;
    expect(b.categorias).toEqual(["P1 · Urgente", "P3 · Media"]); // P4 no tiene fecha límite: sin dato
    expect(b.series[0].valores).toEqual([100, 0]);
    expect(b.unidad).toBe("%");
  });

  it("con muchos proyectos, la cola se junta en «Otros»", () => {
    const proyectos = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `Proyecto ${String(i).padStart(2, "0")}`, area_id: null }));
    const tareas = proyectos.flatMap((p, i) => Array.from({ length: 14 - i }, (_, k) => hecha(`${p.id}-${k}`, "2026-11-03", { project_id: p.id })));
    const d = calcularInforme(espec(["barras hechas por proyecto"]), { tareas, proyectos, areas: [] }, HOY);
    const b = d.bloques[0] as BloqueGrafico;
    expect(b.categorias).toHaveLength(10);
    expect(b.categorias.at(-1)).toBe("Otros (5)");
    expect(b.series[0].valores.at(-1)).toBe(5 + 4 + 3 + 2 + 1);
    expect(b.series[0].valores.reduce((s: number, v) => s + (v ?? 0), 0)).toBe(tareas.length);
  });
});

describe("listas y texto", () => {
  it("lista las tareas hechas en orden, con su puntualidad", () => {
    const tareas = [
      hecha("Tercera", "2026-11-13", { due_date: "2026-11-10" }),
      hecha("Primera", "2026-11-05", { due_date: "2026-11-05", project_id: "correr" }),
      hecha("Segunda", "2026-11-06"),
      hecha("Un día", "2026-11-14", { due_date: "2026-11-13" }),
    ];
    const b = calcular(["lista hechas"], tareas).bloques[0] as BloqueLista;
    expect(b).toMatchObject({ titulo: "Tareas hechas", columna: "Puntualidad", total: 4 });
    expect(b.filas).toEqual([
      { fecha: "2026-11-05", titulo: "Primera", proyecto: "Correr 10 km", detalle: "A tiempo" },
      { fecha: "2026-11-06", titulo: "Segunda", proyecto: "Reformar el baño", detalle: "Sin fecha límite" },
      { fecha: "2026-11-13", titulo: "Tercera", proyecto: "Reformar el baño", detalle: "3 días tarde" },
      { fecha: "2026-11-14", titulo: "Un día", proyecto: "Reformar el baño", detalle: "1 día tarde" },
    ]);
  });

  it("las vencidas dicen hace cuánto; las pendientes, su estado y lo sin fecha al final", () => {
    const tareas = [
      tarea({ title: "Sin fecha" }),
      tarea({ title: "Vencida", due_date: "2026-11-16", status: "bloqueada" }),
      tarea({ title: "Futura", due_date: "2026-11-25", status: "en_curso" }),
    ];
    const d = calcular(["lista vencidas", "lista pendientes"], tareas);
    const [vencidas, pendientes] = d.bloques as BloqueLista[];
    expect(vencidas.filas).toEqual([{ fecha: "2026-11-16", titulo: "Vencida", proyecto: "Reformar el baño", detalle: "3 días" }]);
    expect(pendientes.filas.map((f) => [f.titulo, f.detalle])).toEqual([["Vencida", "Bloqueada"], ["Futura", "En curso"], ["Sin fecha", "Pendiente"]]);
  });

  it("una lista larga guarda 300 filas y dice cuántas son en total", () => {
    const muchas = Array.from({ length: 320 }, (_, i) => hecha(`T${i}`, "2026-11-03"));
    const b = calcular(["lista hechas"], muchas).bloques[0] as BloqueLista;
    expect(b.filas).toHaveLength(300);
    expect(b.total).toBe(320);
    expect(DatosInforme.safeParse(calcular(["lista hechas"], muchas)).success).toBe(true);
  });

  it("escribe los valores como se dicen", () => {
    expect(decirValor(19, "")).toBe("19");
    expect(decirValor(84, "%")).toBe("84 %");
    expect(decirValor(2.5, "días")).toBe("2,5 días");
    expect(decirValor(1, "días")).toBe("1 día");
    expect(decirValor(null, "%")).toBe("—");
  });

  it("resume el informe en líneas de texto para el modelo", () => {
    const tareas = [
      hecha("a", "2026-11-03", { due_date: "2026-11-03" }),
      hecha("b", "2026-11-12", { due_date: "2026-11-10", project_id: "correr" }),
      hecha("vieja", "2026-10-20"),
    ];
    const d = calcular(["numero hechas", "numero puntualidad", "barras a_tiempo,tarde por proyecto", "lista hechas"], tareas);
    expect(resumenInforme(d)).toEqual([
      "Tareas hechas: 2 (período anterior: 1)",
      "Puntualidad: 50 %",
      "Tareas hechas a tiempo y hechas tarde por proyecto (hechas a tiempo/hechas tarde): Reformar el baño 1/0; Correr 10 km 0/1",
      "Lista «Tareas hechas»: 2 tareas",
    ]);
  });
});
