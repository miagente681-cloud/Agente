import { diferenciaDias, fechaEnZona, lunesDe, sumarDias } from "@/lib/datos/fechas";
import { tituloBloque } from "./bloques";
import {
  GRUPOS_DE_TIEMPO, INFO_MEDIDA,
  type BloqueCalculado, type BloqueGrafico, type BloqueLista, type DatosInforme, type EspecBloque,
  type EspecInforme, type Grupo, type Medida,
} from "./tipos";

/**
 * El cálculo de un informe. Es una función pura: recibe las tareas y devuelve
 * los números, sin leer la base ni el reloj, así se prueba con cualquier
 * fecha y zona horaria.
 *
 * Qué cuenta cada medida (siempre tareas principales, no subtareas):
 *  - hechas: se terminaron en el período (el día de `completed_at`, en la zona
 *    de la persona). Cuentan aunque después se hayan archivado.
 *  - creadas: se crearon en el período.
 *  - a_tiempo / tarde: hechas en el período que tenían fecha límite, según si
 *    se terminaron hasta ese día o después. Se compara contra la fecha límite
 *    que la tarea tiene hoy (si se corrió, cuenta la última).
 *  - puntualidad: a_tiempo / (a_tiempo + tarde). Las hechas sin fecha límite
 *    no entran.
 *  - atraso: promedio de días de atraso de las hechas tarde.
 *  - vencidas: sin hacer hoy, con fecha límite ya pasada y anterior al fin del
 *    período. Es una foto de hoy.
 *  - pendientes: sin hacer hoy. Es una foto de hoy; no mira el período.
 */

export type TareaInforme = {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  status: string;
  priority: number;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  archived_at: string | null;
};

export type FuenteInforme = {
  tareas: TareaInforme[];
  proyectos: { id: string; name: string; area_id: string | null }[];
  areas: { id: string; name: string }[];
};

/** Más de esto en un eje no se lee: se pasa a la unidad siguiente. */
const MAX_DIAS = 45;
const MAX_SEMANAS = 30;
const MAX_CATEGORIAS = 10;
export const MAX_FILAS_LISTA = 300;
export const MAX_DIAS_PERIODO = 800;

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const NOMBRE_PRIORIDAD: Record<number, string> = { 1: "P1 · Urgente", 2: "P2 · Alta", 3: "P3 · Media", 4: "P4 · Baja" };
const NOMBRE_ESTADO: Record<string, string> = {
  pendiente: "Pendiente", en_curso: "En curso", bloqueada: "Bloqueada", hecha: "Hecha",
};

/** Una tarea con las fechas ya pasadas a días de calendario de la persona. */
type Fila = TareaInforme & { diaHecha: string | null; diaCreada: string; abierta: boolean };

type Rango = { desde: string; hasta: string };
const dentro = (dia: string | null, r: Rango) => dia !== null && dia >= r.desde && dia <= r.hasta;

/** Las tareas que entran en una medida para un rango de días. */
function deMedida(medida: Exclude<Medida, "puntualidad" | "atraso">, filas: Fila[], r: Rango, hoy: string): Fila[] {
  switch (medida) {
    case "hechas":
      return filas.filter((t) => dentro(t.diaHecha, r));
    case "creadas":
      return filas.filter((t) => dentro(t.diaCreada, r));
    case "a_tiempo":
      return filas.filter((t) => dentro(t.diaHecha, r) && t.due_date !== null && (t.diaHecha as string) <= t.due_date);
    case "tarde":
      return filas.filter((t) => dentro(t.diaHecha, r) && t.due_date !== null && (t.diaHecha as string) > t.due_date);
    case "vencidas":
      return filas.filter((t) => t.abierta && t.due_date !== null && t.due_date < hoy && t.due_date <= r.hasta);
    case "pendientes":
      return filas.filter((t) => t.abierta);
  }
}

const redondear = (n: number) => Math.round(n * 10) / 10;

function valor(medida: Medida, filas: Fila[], r: Rango, hoy: string): number | null {
  if (medida === "puntualidad") {
    const bien = deMedida("a_tiempo", filas, r, hoy).length;
    const mal = deMedida("tarde", filas, r, hoy).length;
    return bien + mal ? Math.round((bien / (bien + mal)) * 100) : null;
  }
  if (medida === "atraso") {
    const tardes = deMedida("tarde", filas, r, hoy);
    if (!tardes.length) return null;
    const dias = tardes.reduce((s, t) => s + diferenciaDias(t.due_date as string, t.diaHecha as string), 0);
    return redondear(dias / tardes.length);
  }
  return deMedida(medida, filas, r, hoy).length;
}

// --- Ejes ------------------------------------------------------------------------

const diaCorto = (iso: string) => `${Number(iso.slice(8))} ${MESES_CORTOS[Number(iso.slice(5, 7)) - 1]}`;

/** Baja la precisión del eje si el período es largo: de días a semanas y de semanas a meses. */
export function grupoEfectivo(grupo: Grupo, r: Rango): Grupo {
  const dias = diferenciaDias(r.desde, r.hasta) + 1;
  if (grupo === "dia" && dias > MAX_DIAS) return grupoEfectivo("semana", r);
  if (grupo === "semana" && dias > MAX_SEMANAS * 7) return "mes";
  return grupo;
}

/** Los tramos de tiempo de un eje, recortados al período. */
export function tramos(grupo: Grupo, r: Rango): { etiqueta: string; rango: Rango }[] {
  const lista: { etiqueta: string; rango: Rango }[] = [];
  const variosAnios = r.desde.slice(0, 4) !== r.hasta.slice(0, 4);
  if (grupo === "dia") {
    for (let d = r.desde; d <= r.hasta; d = sumarDias(d, 1)) {
      lista.push({ etiqueta: diaCorto(d), rango: { desde: d, hasta: d } });
    }
  } else if (grupo === "semana") {
    for (let lunes = lunesDe(r.desde); lunes <= r.hasta; lunes = sumarDias(lunes, 7)) {
      const desde = lunes < r.desde ? r.desde : lunes;
      const domingo = sumarDias(lunes, 6);
      // La semana se nombra por el día en que empieza (dentro del período).
      lista.push({ etiqueta: diaCorto(desde), rango: { desde, hasta: domingo > r.hasta ? r.hasta : domingo } });
    }
  } else {
    for (let primero = r.desde.slice(0, 7) + "-01"; primero <= r.hasta; ) {
      const [a, m] = primero.split("-").map(Number);
      const siguiente = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
      const ultimo = sumarDias(siguiente, -1);
      lista.push({
        etiqueta: MESES_CORTOS[m - 1] + (variosAnios ? ` ${String(a).slice(2)}` : ""),
        rango: { desde: primero < r.desde ? r.desde : primero, hasta: ultimo > r.hasta ? r.hasta : ultimo },
      });
      primero = siguiente;
    }
  }
  return lista;
}

// --- Bloques ---------------------------------------------------------------------

type Entorno = {
  filas: Fila[];
  periodo: Rango;
  anterior: Rango;
  hoy: string;
  nombreProyecto: Map<string, string>;
  areaDeProyecto: Map<string, string>;
};

function grafico(b: EspecBloque, e: Entorno): BloqueGrafico {
  const tipo = b.tipo as BloqueGrafico["tipo"];
  const pedido = b.agrupar as Grupo;
  const unidad = INFO_MEDIDA[b.medidas[0]].unidad;
  const nombres = b.medidas.map((m) => INFO_MEDIDA[m].nombre);

  if (GRUPOS_DE_TIEMPO.includes(pedido)) {
    const agrupar = grupoEfectivo(pedido, e.periodo);
    const eje = tramos(agrupar, e.periodo);
    return {
      tipo,
      titulo: tituloBloque({ ...b, agrupar }),
      agrupar,
      unidad,
      categorias: eje.map((t) => t.etiqueta),
      series: b.medidas.map((medida, i) => ({
        medida,
        nombre: nombres[i],
        valores: eje.map((t) => valor(medida, e.filas, t.rango, e.hoy)),
      })),
    };
  }

  // Por proyecto, área o prioridad: se separan las tareas y se calcula cada grupo.
  const claveDe = (t: Fila) =>
    pedido === "proyecto"
      ? (e.nombreProyecto.get(t.project_id) ?? "Proyecto borrado")
      : pedido === "area"
        ? (e.areaDeProyecto.get(t.project_id) ?? "Sin área")
        : (NOMBRE_PRIORIDAD[t.priority] ?? `P${t.priority}`);
  const grupos = new Map<string, Fila[]>();
  for (const t of e.filas) grupos.set(claveDe(t), [...(grupos.get(claveDe(t)) ?? []), t]);

  let filas = [...grupos].map(([nombre, tareas]) => ({
    nombre,
    valores: b.medidas.map((medida) => valor(medida, tareas, e.periodo, e.hoy)),
  }));
  // Un grupo sin nada que mostrar no ocupa lugar.
  filas = filas.filter((f) => f.valores.some((v) => v !== null && v > 0) || (unidad !== "" && f.valores[0] !== null));

  if (pedido === "prioridad") {
    // La prioridad tiene un orden propio: no se reordena por valor.
    filas.sort((x, y) => x.nombre.localeCompare(y.nombre));
  } else {
    filas.sort((x, y) => (y.valores[0] ?? -1) - (x.valores[0] ?? -1) || x.nombre.localeCompare(y.nombre));
    if (filas.length > MAX_CATEGORIAS) {
      const cola = filas.slice(MAX_CATEGORIAS - 1);
      filas = filas.slice(0, MAX_CATEGORIAS - 1);
      // Las cantidades de la cola se suman en «Otros»; un porcentaje no se puede sumar.
      if (unidad === "") {
        filas.push({
          nombre: `Otros (${cola.length})`,
          valores: b.medidas.map((_, i) => cola.reduce((s, f) => s + (f.valores[i] ?? 0), 0)),
        });
      }
    }
  }
  return {
    tipo,
    titulo: tituloBloque(b),
    agrupar: pedido,
    unidad,
    categorias: filas.map((f) => f.nombre),
    series: b.medidas.map((medida, i) => ({ medida, nombre: nombres[i], valores: filas.map((f) => f.valores[i]) })),
  };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function listar(b: EspecBloque, e: Entorno): BloqueLista {
  const medida = b.medidas[0] as Exclude<Medida, "puntualidad" | "atraso">;
  const tareas = deMedida(medida, e.filas, e.periodo, e.hoy);
  const estado = (t: Fila) => (t.archived_at ? "Archivada" : (NOMBRE_ESTADO[t.status] ?? t.status));
  const puntualidad = (t: Fila) =>
    t.due_date === null
      ? "Sin fecha límite"
      : (t.diaHecha as string) <= t.due_date
        ? "A tiempo"
        : plural(diferenciaDias(t.due_date, t.diaHecha as string), "día tarde", "días tarde");

  const forma: Record<typeof medida, { columna: string; fecha: (t: Fila) => string | null; detalle: (t: Fila) => string }> = {
    hechas: { columna: "Puntualidad", fecha: (t) => t.diaHecha, detalle: puntualidad },
    a_tiempo: { columna: "Vencía", fecha: (t) => t.diaHecha, detalle: (t) => diaCorto(t.due_date as string) },
    tarde: { columna: "Atraso", fecha: (t) => t.diaHecha, detalle: puntualidad },
    creadas: { columna: "Estado hoy", fecha: (t) => t.diaCreada, detalle: estado },
    vencidas: {
      columna: "Vencida hace",
      fecha: (t) => t.due_date,
      detalle: (t) => plural(diferenciaDias(t.due_date as string, e.hoy), "día", "días"),
    },
    pendientes: { columna: "Estado", fecha: (t) => t.due_date, detalle: estado },
  };
  const f = forma[medida];
  // En orden de fecha; lo que no tiene fecha, al final.
  const ordenadas = [...tareas].sort(
    (x, y) => (f.fecha(x) ?? "9999").localeCompare(f.fecha(y) ?? "9999") || x.title.localeCompare(y.title),
  );
  return {
    tipo: "lista",
    titulo:
      tituloBloque(b) +
      // En las fotos de hoy la fecha de la lista es la fecha límite.
      (medida === "pendientes" ? " (con su fecha límite)" : ""),
    medida,
    columna: f.columna,
    filas: ordenadas.slice(0, MAX_FILAS_LISTA).map((t) => ({
      fecha: f.fecha(t),
      titulo: t.title.slice(0, 300),
      proyecto: (e.nombreProyecto.get(t.project_id) ?? "Proyecto borrado").slice(0, 200),
      detalle: f.detalle(t),
    })),
    total: tareas.length,
  };
}

function bloque(b: EspecBloque, e: Entorno): BloqueCalculado {
  if (b.tipo === "lista") return listar(b, e);
  if (b.tipo !== "numero") return grafico(b, e);
  const medida = b.medidas[0];
  return {
    tipo: "numero",
    titulo: tituloBloque(b),
    medida,
    unidad: INFO_MEDIDA[medida].unidad,
    valor: valor(medida, e.filas, e.periodo, e.hoy),
    // Una foto de hoy no tiene «período anterior» con el que compararse.
    anterior: INFO_MEDIDA[medida].foto ? null : valor(medida, e.filas, e.anterior, e.hoy),
  };
}

export function calcularInforme(espec: EspecInforme, fuente: FuenteInforme, c: { hoy: string; zona: string }): DatosInforme {
  const proyectos = new Map(fuente.proyectos.map((p) => [p.id, p]));
  const areas = new Map(fuente.areas.map((a) => [a.id, a.name]));

  const filas: Fila[] = fuente.tareas
    .filter((t) => t.parent_id === null)
    .filter((t) => !espec.proyectoId || t.project_id === espec.proyectoId)
    .filter((t) => !espec.areaId || proyectos.get(t.project_id)?.area_id === espec.areaId)
    .map((t) => ({
      ...t,
      diaHecha: t.status === "hecha" && t.completed_at ? fechaEnZona(t.completed_at, c.zona) : null,
      diaCreada: fechaEnZona(t.created_at, c.zona),
      abierta: t.status !== "hecha" && t.archived_at === null,
    }));

  const periodo = { desde: espec.desde, hasta: espec.hasta };
  const largo = diferenciaDias(espec.desde, espec.hasta) + 1;
  const anterior = { desde: sumarDias(espec.desde, -largo), hasta: sumarDias(espec.desde, -1) };

  const entorno: Entorno = {
    filas,
    periodo,
    anterior,
    hoy: c.hoy,
    nombreProyecto: new Map(fuente.proyectos.map((p) => [p.id, p.name])),
    areaDeProyecto: new Map(
      fuente.proyectos.flatMap((p) => (p.area_id && areas.has(p.area_id) ? [[p.id, areas.get(p.area_id) as string]] : [])),
    ),
  };

  const filtro = espec.proyectoId
    ? `Proyecto: ${proyectos.get(espec.proyectoId)?.name ?? "—"}`
    : espec.areaId
      ? `Área: ${areas.get(espec.areaId) ?? "—"}`
      : null;

  return {
    version: 1,
    zona: c.zona,
    hoy: c.hoy,
    desde: espec.desde,
    hasta: espec.hasta,
    anterior,
    filtro,
    bloques: espec.bloques.map((b) => bloque(b, entorno)),
  };
}

// --- Texto ------------------------------------------------------------------------

/** «19», «84 %», «2,5 días», «—». */
export function decirValor(v: number | null, unidad: string): string {
  if (v === null) return "—";
  const numero = String(v).replace(".", ",");
  return unidad === "%" ? `${numero} %` : unidad === "días" ? `${numero} ${v === 1 ? "día" : "días"}` : numero;
}

/**
 * El informe en pocas líneas de texto. Es lo que recibe el modelo: para
 * comentarle los números a la persona y para escribir la lectura del informe.
 */
export function resumenInforme(datos: DatosInforme): string[] {
  return datos.bloques.map((b) => {
    if (b.tipo === "numero") {
      return (
        `${b.titulo}: ${decirValor(b.valor, b.unidad)}` +
        (b.anterior !== null ? ` (período anterior: ${decirValor(b.anterior, b.unidad)})` : "")
      );
    }
    if (b.tipo === "lista") {
      return `Lista «${b.titulo}»: ${plural(b.total, "tarea", "tareas")}`;
    }
    const filas = b.categorias.slice(0, 14).map((cat, i) => {
      const valores = b.series.map((s) => decirValor(s.valores[i], b.unidad));
      return `${cat} ${b.series.length > 1 ? valores.join("/") : valores[0]}`;
    });
    const series = b.series.length > 1 ? ` (${b.series.map((s) => INFO_MEDIDA[s.medida].corto).join("/")})` : "";
    return `${b.titulo}${series}: ${filas.join("; ") || "sin datos"}` + (b.categorias.length > 14 ? "; …" : "");
  });
}
