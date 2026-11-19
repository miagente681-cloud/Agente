import { z } from "zod";

/**
 * Informes: qué se puede medir y cómo se guarda el resultado.
 *
 * Un informe es una lista de bloques (un número, un gráfico o una lista de
 * tareas). El Agente elige los bloques; los números los calcula la app
 * (calcular.ts), nunca el modelo. El resultado se guarda tal cual en la tabla
 * `informes`, así un informe viejo sigue mostrando lo que decía ese día.
 */

export const MEDIDAS = [
  "hechas", "creadas", "a_tiempo", "tarde", "vencidas", "pendientes", "puntualidad", "atraso",
] as const;
export type Medida = (typeof MEDIDAS)[number];

export const GRUPOS = ["dia", "semana", "mes", "proyecto", "area", "prioridad"] as const;
export type Grupo = (typeof GRUPOS)[number];
export const GRUPOS_DE_TIEMPO: readonly Grupo[] = ["dia", "semana", "mes"];

export const TIPOS_BLOQUE = ["numero", "barras", "lineas", "reparto", "lista"] as const;
export type TipoBloque = (typeof TIPOS_BLOQUE)[number];

export type Unidad = "" | "%" | "días";

type InfoMedida = {
  /** Título completo: «Tareas hechas». */
  nombre: string;
  /** Para combinar en un título: «hechas». */
  corto: string;
  unidad: Unidad;
  /**
   * Color en los gráficos (1 azul, 2 naranja, 3 verde agua). Son los tres
   * primeros del catálogo, los únicos que se distinguen entre sí de a pares
   * también con daltonismo (validado con el verificador de paletas). Dos
   * medidas del mismo color no pueden ir en el mismo gráfico.
   */
  color: 1 | 2 | 3;
  /** Para el signo de la comparación con el período anterior. */
  subirEsBueno: boolean | null;
  /** Es una foto de hoy (no un conteo del período): no se compara ni se agrupa por tiempo. */
  foto?: boolean;
  /** Es una proporción o un promedio: va sola en su gráfico y no se lista. */
  razon?: boolean;
};

export const INFO_MEDIDA: Record<Medida, InfoMedida> = {
  hechas: { nombre: "Tareas hechas", corto: "hechas", unidad: "", color: 1, subirEsBueno: true },
  a_tiempo: { nombre: "Hechas a tiempo", corto: "hechas a tiempo", unidad: "", color: 1, subirEsBueno: true },
  tarde: { nombre: "Hechas tarde", corto: "hechas tarde", unidad: "", color: 2, subirEsBueno: false },
  vencidas: { nombre: "Vencidas sin hacer", corto: "vencidas sin hacer", unidad: "", color: 2, subirEsBueno: false, foto: true },
  creadas: { nombre: "Tareas creadas", corto: "creadas", unidad: "", color: 3, subirEsBueno: null },
  pendientes: { nombre: "Pendientes hoy", corto: "pendientes", unidad: "", color: 3, subirEsBueno: null, foto: true },
  puntualidad: { nombre: "Puntualidad", corto: "puntualidad", unidad: "%", color: 1, subirEsBueno: true, razon: true },
  atraso: { nombre: "Atraso promedio", corto: "atraso promedio", unidad: "días", color: 2, subirEsBueno: false, razon: true },
};

export const NOMBRE_GRUPO: Record<Grupo, string> = {
  dia: "día", semana: "semana", mes: "mes", proyecto: "proyecto", area: "área", prioridad: "prioridad",
};

/** Un bloque tal como lo pide el Agente (ya leído y validado). */
export type EspecBloque = { tipo: TipoBloque; medidas: Medida[]; agrupar: Grupo | null };

export type EspecInforme = {
  titulo: string;
  desde: string;
  hasta: string;
  proyectoId: string | null;
  areaId: string | null;
  bloques: EspecBloque[];
};

// --- Resultado calculado (lo que se guarda y se muestra) ------------------------

const medida = z.enum(MEDIDAS);
const unidad = z.enum(["", "%", "días"]);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const numero = z.number().finite().nullable();

const BloqueNumero = z.object({
  tipo: z.literal("numero"),
  titulo: z.string().max(200),
  medida,
  unidad,
  valor: numero,
  /** El mismo cálculo en el período anterior de igual largo; null si no aplica. */
  anterior: numero,
});

const BloqueGrafico = z.object({
  tipo: z.enum(["barras", "lineas", "reparto"]),
  titulo: z.string().max(200),
  agrupar: z.enum(GRUPOS),
  unidad,
  categorias: z.array(z.string().max(120)).max(64),
  series: z
    .array(z.object({ medida, nombre: z.string().max(80), valores: z.array(numero).max(64) }))
    .min(1)
    .max(3),
});

const BloqueLista = z.object({
  tipo: z.literal("lista"),
  titulo: z.string().max(200),
  medida,
  /** Encabezado de la última columna («Puntualidad», «Estado»…). */
  columna: z.string().max(40),
  filas: z
    .array(
      z.object({
        fecha: fecha.nullable(),
        titulo: z.string().max(300),
        proyecto: z.string().max(200),
        detalle: z.string().max(80),
      }),
    )
    .max(300),
  /** Cuántas hay en total (la lista guarda como mucho 300). */
  total: z.number().int().min(0),
});

export const BloqueCalculado = z.discriminatedUnion("tipo", [BloqueNumero, BloqueGrafico, BloqueLista]);
export type BloqueNumero = z.infer<typeof BloqueNumero>;
export type BloqueGrafico = z.infer<typeof BloqueGrafico>;
export type BloqueLista = z.infer<typeof BloqueLista>;
export type BloqueCalculado = z.infer<typeof BloqueCalculado>;

export const DatosInforme = z.object({
  version: z.literal(1),
  zona: z.string().max(80),
  /** El día en que se armó, en la zona de la persona. */
  hoy: fecha,
  desde: fecha,
  hasta: fecha,
  anterior: z.object({ desde: fecha, hasta: fecha }),
  /** «Proyecto: Reformar el baño», «Área: Casa» o null. */
  filtro: z.string().max(240).nullable(),
  bloques: z.array(BloqueCalculado).min(1).max(8),
});
export type DatosInforme = z.infer<typeof DatosInforme>;

/** Una fila de la tabla `informes`. */
export type FilaInforme = {
  id: string;
  titulo: string;
  desde: string;
  hasta: string;
  datos: unknown;
  analisis: string | null;
  session_id: string | null;
  created_at: string;
};
