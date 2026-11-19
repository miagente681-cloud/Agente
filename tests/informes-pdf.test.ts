import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { leerBloques } from "@/lib/informes/bloques";
import { calcularInforme, type TareaInforme } from "@/lib/informes/calcular";
import { escalones, escenaDe, graficoVacio, recortar } from "@/lib/informes/escena";
import { limpiarLectura } from "@/lib/informes/lectura";
import { armarPdf } from "@/lib/informes/pdf";
import { comparar, periodoLegible } from "@/lib/informes/texto";
import type { BloqueGrafico, BloqueNumero } from "@/lib/informes/tipos";

const PROYECTOS = [
  { id: "banio", name: "Reformar el baño", area_id: "casa" },
  { id: "correr", name: "Correr 10 km", area_id: "salud" },
  { id: "curso", name: "Curso de inglés: nivel intermedio con examen final", area_id: null },
];
const AREAS = [{ id: "casa", name: "Casa" }, { id: "salud", name: "Salud" }];

/** Tareas de noviembre repartidas en tres proyectos, algunas tarde. */
function tareas(cuantas: number): TareaInforme[] {
  return Array.from({ length: cuantas }, (_, i) => {
    const dia = String((i % 28) + 1).padStart(2, "0");
    const vence = String(((i * 7) % 28) + 1).padStart(2, "0");
    return {
      id: `t${i}`, project_id: PROYECTOS[i % 3].id, parent_id: null,
      title: i % 9 === 0 ? `Tarea ${i} con un título bien largo para ver cómo se parte en dos renglones dentro de la tabla del informe` : `Tarea número ${i}`,
      status: i % 5 === 4 ? "pendiente" : "hecha", priority: (i % 4) + 1,
      due_date: i % 6 === 0 ? null : `2026-11-${vence}`,
      completed_at: i % 5 === 4 ? null : `2026-11-${dia}T15:00:00Z`,
      created_at: `2026-11-${String((i % 20) + 1).padStart(2, "0")}T12:00:00Z`, archived_at: null,
    };
  });
}

function informe(bloques: string[], cuantas = 60, titulo = "Tareas hechas en noviembre") {
  const leidos = leerBloques(bloques);
  if (!leidos.ok) throw new Error(leidos.error);
  const datos = calcularInforme(
    { titulo, desde: "2026-11-01", hasta: "2026-11-30", proyectoId: null, areaId: null, bloques: leidos.bloques },
    { tareas: tareas(cuantas), proyectos: PROYECTOS, areas: AREAS },
    { hoy: "2026-11-30", zona: "America/Montevideo" },
  );
  return { titulo, datos, creado: "2026-11-30T18:30:00Z", analisis: "Hiciste 48 tareas y dos de cada tres salieron a tiempo. Lo más flojo es el baño, donde se te pasan las fechas. Poné las fechas con un día de margen y probá cerrar lo vencido antes de sumar tareas nuevas." };
}

describe("PDF del informe", () => {
  it("arma un PDF válido con números, gráficos y una lista que pasa de página", async () => {
    const bytes = await armarPdf(
      informe([
        "numero hechas", "numero puntualidad", "numero atraso", "numero pendientes",
        "barras hechas,creadas por semana", "lineas puntualidad por semana",
        "reparto hechas por proyecto", "lista hechas",
      ]),
    );
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toBe("Tareas hechas en noviembre");
    if (process.env.GUARDAR_PDF) writeFileSync(process.env.GUARDAR_PDF, bytes);
  });

  it("no se rompe con emojis, flechas, saltos de línea ni un informe vacío", async () => {
    const raro = informe(["numero hechas", "barras hechas por dia", "lista vencidas", "barras tarde por proyecto"], 0, "Informe 🚀 → con\nsaltos\ty «comillas» — 100 %");
    raro.datos.bloques.push({
      tipo: "lista", titulo: "Lista ✅ rara", medida: "hechas", columna: "Estado", total: 1,
      filas: [{ fecha: null, titulo: "Comprar 🍕 → pizza ≥ 2", proyecto: "Hogar 🏠", detalle: "A tiempo ✓" }],
    });
    const bytes = await armarPdf({ ...raro, analisis: null });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("una lista de 300 filas ocupa varias páginas", async () => {
    const bytes = await armarPdf(informe(["lista creadas"], 300));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(5);
  });
});

describe("geometría de los gráficos", () => {
  const bloque = (texto: string, cuantas = 60) => informe([texto], cuantas).datos.bloques[0] as BloqueGrafico;

  it("el eje usa escalones redondos y nunca queda por debajo del máximo", () => {
    expect(escalones(9, true)).toEqual([0, 5, 10]);
    expect(escalones(3, true)).toEqual([0, 1, 2, 3]);
    expect(escalones(47, true)).toEqual([0, 20, 40, 60]);
    expect(escalones(2.5, false)).toEqual([0, 1, 2, 3]);
    expect(escalones(0, true)).toEqual([0, 1]);
  });

  it("columnas: una franja por tramo, barras finas y dentro del dibujo", () => {
    const b = bloque("barras hechas,creadas por semana");
    const e = escenaDe(b, 600);
    expect(e.zonas).toHaveLength(b.categorias.length);
    expect(e.zonas[0].filas.map((f) => f.nombre)).toEqual(["Tareas hechas", "Tareas creadas"]);
    const rellenos = e.formas.filter((f) => f.relleno);
    expect(new Set(rellenos.map((f) => f.relleno))).toEqual(new Set(["serie1", "serie3"]));
    // Ningún número del trazo se sale del ancho o del alto.
    for (const f of e.formas) {
      const numeros = f.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(Math.min(...numeros)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numeros)).toBeLessThanOrEqual(600);
    }
  });

  it("con muchos días rotula solo el máximo y saltea etiquetas del eje", () => {
    const e = escenaDe(bloque("barras hechas por dia"), 340);
    const valores = e.textos.filter((t) => t.tono === "texto2");
    expect(valores).toHaveLength(1);
    const delEje = e.textos.filter((t) => t.ancla === "medio" && t.tono === "tenue");
    expect(delEje.length).toBeLessThan(30);
    expect(delEje.length).toBeGreaterThan(2);
  });

  it("por categoría: en pantallas angostas el nombre va arriba de la barra", () => {
    const b = bloque("reparto hechas por proyecto");
    const ancho = escenaDe(b, 600);
    const angosto = escenaDe(b, 320);
    expect(angosto.alto).toBeGreaterThan(ancho.alto);
    // El reparto dice cantidad y porcentaje, y los porcentajes suman cerca de 100.
    const porcentajes = ancho.textos.flatMap((t) => (/· (\d+) %$/.exec(t.texto) ? [Number(/· (\d+) %$/.exec(t.texto)![1])] : []));
    expect(porcentajes).toHaveLength(3);
    expect(Math.abs(porcentajes.reduce((s, p) => s + p, 0) - 100)).toBeLessThanOrEqual(2);
    // Un nombre de proyecto muy largo se recorta en lugar de pisar la barra.
    expect(ancho.textos.filter((t) => t.texto.endsWith("…"))).toHaveLength(1);
    expect(angosto.textos.every((t) => t.x >= 0 && t.x <= 320)).toBe(true);
  });

  it("un gráfico sin datos se reconoce como vacío", () => {
    expect(graficoVacio(bloque("barras hechas por semana", 0))).toBe(true);
    expect(graficoVacio(bloque("barras hechas por semana"))).toBe(false);
    expect(recortar("Un nombre de proyecto larguísimo", 60, 12)).toMatch(/…$/);
  });
});

describe("textos del informe", () => {
  it("dice el período como se lee", () => {
    expect(periodoLegible("2026-11-01", "2026-11-30")).toBe("1 al 30 de noviembre de 2026");
    expect(periodoLegible("2026-10-15", "2026-11-14")).toBe("15 de octubre al 14 de noviembre de 2026");
    expect(periodoLegible("2025-12-01", "2026-01-31")).toBe("1 de diciembre de 2025 al 31 de enero de 2026");
    expect(periodoLegible("2026-11-19", "2026-11-19")).toBe("19 de noviembre de 2026");
  });

  it("compara con el período anterior y dice si el cambio es bueno o malo", () => {
    const n = (medida: BloqueNumero["medida"], valor: number | null, anterior: number | null, unidad: BloqueNumero["unidad"] = ""): BloqueNumero =>
      ({ tipo: "numero", titulo: "x", medida, unidad, valor, anterior });
    expect(comparar(n("hechas", 12, 8))).toEqual({ texto: "+4", direccion: "sube", sentido: "bien" });
    expect(comparar(n("tarde", 5, 2))).toEqual({ texto: "+3", direccion: "sube", sentido: "mal" });
    expect(comparar(n("atraso", 1.5, 3, "días"))).toEqual({ texto: "−1,5 días", direccion: "baja", sentido: "bien" });
    expect(comparar(n("puntualidad", 59, 60, "%"))).toEqual({ texto: "−1 punto", direccion: "baja", sentido: "mal" });
    expect(comparar(n("creadas", 3, 9))).toMatchObject({ sentido: "neutro" });
    expect(comparar(n("hechas", 4, 4))).toEqual({ texto: "igual", direccion: "igual", sentido: "neutro" });
    expect(comparar(n("puntualidad", null, 50, "%"))).toBeNull();
    expect(comparar(n("pendientes", 7, null))).toBeNull();
  });

  it("deja la lectura del modelo como un párrafo limpio", () => {
    expect(limpiarLectura("  **Vas bien**.\n\n- Seguí así, _pero_ cerrá lo vencido.  ")).toBe("Vas bien. Seguí así, pero cerrá lo vencido.");
    expect(limpiarLectura("«Hiciste 19 tareas y casi todas a tiempo.»")).toBe("Hiciste 19 tareas y casi todas a tiempo.");
    expect(limpiarLectura("ok")).toBeNull();
    expect(limpiarLectura(null)).toBeNull();
    const largo = limpiarLectura(("Una oración de relleno para pasar el largo. ").repeat(40))!;
    expect(largo.length).toBeLessThanOrEqual(900);
    expect(largo.endsWith(".")).toBe(true);
  });
});
