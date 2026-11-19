import {
  GRUPOS, GRUPOS_DE_TIEMPO, INFO_MEDIDA, MEDIDAS, NOMBRE_GRUPO, TIPOS_BLOQUE,
  type EspecBloque, type Grupo, type Medida, type TipoBloque,
} from "./tipos";

/**
 * Cómo pide el Agente cada bloque de un informe: un texto corto,
 * «tipo medidas [por grupo]». Por ejemplo:
 *
 *   numero hechas
 *   barras hechas,creadas por semana
 *   lineas puntualidad por mes
 *   reparto hechas por proyecto
 *   lista tarde
 *
 * Es un texto y no un objeto para que la definición de la herramienta sea
 * chica (el cupo de Groq se mide en tokens) y porque a los modelos les resulta
 * fácil de escribir. Acá se lee, se valida y, si algo no cierra, se devuelve
 * un mensaje que el modelo puede usar para corregir.
 */

export type BloqueLeido = { ok: true; bloque: EspecBloque } | { ok: false; error: string };

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Otras formas de decir lo mismo que se aceptan sin protestar. */
const ALIAS_TIPO: Record<string, TipoBloque> = {
  numero: "numero", total: "numero", kpi: "numero",
  barras: "barras", barra: "barras", columnas: "barras",
  lineas: "lineas", linea: "lineas",
  reparto: "reparto", torta: "reparto", dona: "reparto",
  lista: "lista", tabla: "lista",
};
const ALIAS_GRUPO: Record<string, Grupo> = {
  dia: "dia", dias: "dia", semana: "semana", semanas: "semana", mes: "mes", meses: "mes",
  proyecto: "proyecto", proyectos: "proyecto", area: "area", areas: "area", prioridad: "prioridad",
};

const lista = (xs: readonly string[]) => xs.join(", ");

export function leerBloque(texto: string): BloqueLeido {
  const limpio = sinTildes(texto).replace(/\ba tiempo\b/g, "a_tiempo").replace(/\s*,\s*/g, ",").trim().replace(/\s+/g, " ");
  const m = /^(\S+) (\S+)(?: por (\S+))?$/.exec(limpio);
  if (!m) return { ok: false, error: `«${texto}»: usá «tipo medidas [por grupo]», por ejemplo «barras hechas por semana».` };

  const tipo = ALIAS_TIPO[m[1]];
  if (!tipo) return { ok: false, error: `«${m[1]}» no es un tipo de bloque. Tipos: ${lista(TIPOS_BLOQUE)}.` };

  const medidas = m[2].split(",") as Medida[];
  const desconocida = medidas.find((x) => !MEDIDAS.includes(x));
  if (desconocida) return { ok: false, error: `«${desconocida}» no es una medida. Medidas: ${lista(MEDIDAS)}.` };
  if (new Set(medidas).size !== medidas.length) return { ok: false, error: `«${texto}»: hay una medida repetida.` };

  let agrupar: Grupo | null = null;
  if (m[3]) {
    agrupar = ALIAS_GRUPO[m[3]] ?? null;
    if (!agrupar) return { ok: false, error: `«${m[3]}» no es un grupo. Grupos: ${lista(GRUPOS)}.` };
  }

  const info = medidas.map((x) => INFO_MEDIDA[x]);
  const razon = medidas.find((x) => INFO_MEDIDA[x].razon);

  if (tipo === "numero" || tipo === "lista" || tipo === "reparto") {
    if (medidas.length !== 1) return { ok: false, error: `«${texto}»: un bloque «${tipo}» lleva una sola medida.` };
  }
  if (tipo === "numero" || tipo === "lista") {
    if (agrupar) return { ok: false, error: `«${texto}»: un bloque «${tipo}» no lleva «por ${m[3]}».` };
  } else if (!agrupar) {
    return { ok: false, error: `«${texto}»: falta «por grupo» (${lista(GRUPOS)}).` };
  }
  if ((tipo === "lista" || tipo === "reparto") && razon) {
    return { ok: false, error: `«${texto}»: «${razon}» es un porcentaje o un promedio; usala con numero, barras o lineas.` };
  }
  if (medidas.length > 1) {
    // Un solo eje por gráfico: no se mezclan cantidades con porcentajes o días.
    if (razon) return { ok: false, error: `«${texto}»: «${razon}» va sola en su gráfico. Hacé un bloque aparte.` };
    if (medidas.length > 3) return { ok: false, error: `«${texto}»: como mucho tres medidas por gráfico.` };
    const repetido = info.find((a, i) => info.findIndex((b) => b.color === a.color) !== i);
    if (repetido) {
      const par = medidas.filter((x) => INFO_MEDIDA[x].color === repetido.color);
      return { ok: false, error: `«${texto}»: «${par[0]}» y «${par[1]}» no van en el mismo gráfico. Hacé un bloque para cada una.` };
    }
  }
  const deTiempo = agrupar !== null && GRUPOS_DE_TIEMPO.includes(agrupar);
  if (tipo === "lineas" && !deTiempo) {
    return { ok: false, error: `«${texto}»: las líneas van por dia, semana o mes. Para ${NOMBRE_GRUPO[agrupar as Grupo]} usá barras.` };
  }
  if (tipo === "reparto" && deTiempo) {
    return { ok: false, error: `«${texto}»: el reparto va por proyecto, area o prioridad. Para el tiempo usá barras o lineas.` };
  }
  const foto = medidas.find((x) => INFO_MEDIDA[x].foto);
  if (foto && deTiempo) {
    return { ok: false, error: `«${texto}»: «${foto}» es una foto de hoy; agrupala por proyecto, area o prioridad.` };
  }
  return { ok: true, bloque: { tipo, medidas, agrupar } };
}

/** Lee todos los bloques; si alguno está mal, devuelve los problemas juntos. */
export function leerBloques(textos: string[]): { ok: true; bloques: EspecBloque[] } | { ok: false; error: string } {
  const leidos = textos.map(leerBloque);
  const errores = leidos.flatMap((l) => (l.ok ? [] : [l.error]));
  if (errores.length) return { ok: false, error: errores.slice(0, 3).join(" ") };
  return { ok: true, bloques: leidos.flatMap((l) => (l.ok ? [l.bloque] : [])) };
}

/** Título de un bloque: «Tareas hechas y creadas por semana». */
export function tituloBloque(b: EspecBloque): string {
  const [primera] = b.medidas;
  if (b.tipo === "numero") return INFO_MEDIDA[primera].nombre;
  if (b.tipo === "lista") return INFO_MEDIDA[primera].nombre;
  const que =
    b.medidas.length === 1
      ? INFO_MEDIDA[primera].nombre
      : // «Tareas hechas, creadas y pendientes»
        "Tareas " +
        b.medidas
          .map((x) => INFO_MEDIDA[x].corto)
          .join(", ")
          .replace(/, ([^,]*)$/, " y $1");
  const por = b.agrupar ? ` por ${NOMBRE_GRUPO[b.agrupar]}` : "";
  return b.tipo === "reparto" ? `${que}: reparto${por}` : que + por;
}
