import { decirValor } from "./calcular";
import { GRUPOS_DE_TIEMPO, INFO_MEDIDA, type BloqueGrafico } from "./tipos";

/**
 * La geometría de un gráfico, sin dibujarlo: una lista de trazos y textos con
 * sus posiciones. La pantalla (SVG) y el PDF dibujan la misma escena, así un
 * gráfico se ve igual en los dos lados y la cuenta se hace una sola vez.
 *
 * Coordenadas como en SVG: origen arriba a la izquierda, «y» hacia abajo. La
 * «y» de un texto es su línea de base.
 *
 * Criterios de dibujo (los mismos en todos los gráficos):
 *  - barras finas (hasta 24), con la punta redondeada y la base recta;
 *  - líneas de 2, puntos de radio 4 con un anillo del color del fondo;
 *  - grilla y ejes muy tenues; el dato es lo único que resalta;
 *  - los valores se rotulan con moderación: todos si son pocos, si no solo el
 *    máximo o el último. El resto se lee con el eje, al pasar el cursor o en
 *    la tabla.
 */

export type Tono = "serie1" | "serie2" | "serie3" | "grilla" | "eje" | "texto" | "texto2" | "tenue" | "superficie";
export type Forma = { d: string; relleno?: Tono; trazo?: Tono; grosor?: number };
export type Texto = {
  x: number;
  y: number;
  texto: string;
  tam: number;
  ancla: "inicio" | "medio" | "fin";
  tono: Tono;
};
/** Una franja sensible: al pasar por arriba (o enfocarla) se muestran sus valores. */
export type Zona = {
  x: number;
  y: number;
  ancho: number;
  alto: number;
  titulo: string;
  filas: { nombre: string; valor: string; tono: Tono }[];
};
export type Escena = { ancho: number; alto: number; formas: Forma[]; textos: Texto[]; zonas: Zona[] };

const TONO_SERIE: Record<1 | 2 | 3, Tono> = { 1: "serie1", 2: "serie2", 3: "serie3" };
export const tonoDe = (medida: keyof typeof INFO_MEDIDA): Tono => TONO_SERIE[INFO_MEDIDA[medida].color];

/** Nombre y color de cada serie, para la leyenda (solo hace falta con dos o más). */
export const leyendaDe = (b: BloqueGrafico) => b.series.map((s) => ({ nombre: s.nombre, tono: tonoDe(s.medida) }));

/** Ancho aproximado de un texto: alcanza para decidir si un rótulo entra. */
const ANCHO_LETRA = 0.56;
export const anchoTexto = (texto: string, tam: number) => texto.length * tam * ANCHO_LETRA;

export function recortar(texto: string, anchoMaximo: number, tam: number): string {
  if (anchoTexto(texto, tam) <= anchoMaximo) return texto;
  const letras = Math.max(1, Math.floor(anchoMaximo / (tam * ANCHO_LETRA)) - 1);
  return texto.slice(0, letras).trimEnd() + "…";
}

const n2 = (x: number) => Math.round(x * 100) / 100;

/** Escalones redondos para el eje: 0, 5, 10… El tope nunca queda por debajo del máximo. */
export function escalones(maximo: number, enteros: boolean): number[] {
  if (maximo <= 0) return [0, 1];
  const crudo = maximo / 4;
  const potencia = 10 ** Math.floor(Math.log10(crudo));
  // Para cantidades, pasos de 1, 2 o 5 (por diez, por cien…): un eje de a 3 no se lee de un vistazo.
  const multiplos = enteros ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const paso = multiplos.map((m) => m * potencia).find((p) => p >= crudo) ?? 10 * potencia;
  const usado = enteros ? Math.max(1, Math.ceil(paso)) : paso;
  const lista: number[] = [];
  for (let v = 0; v < maximo + usado - 1e-9; v += usado) lista.push(n2(v));
  return lista;
}

const circulo = (cx: number, cy: number, r: number) => {
  // Cuatro curvas: lo entienden igual el SVG y el PDF.
  const k = 0.5523 * r;
  return (
    `M ${n2(cx - r)} ${n2(cy)} ` +
    `C ${n2(cx - r)} ${n2(cy - k)} ${n2(cx - k)} ${n2(cy - r)} ${n2(cx)} ${n2(cy - r)} ` +
    `C ${n2(cx + k)} ${n2(cy - r)} ${n2(cx + r)} ${n2(cy - k)} ${n2(cx + r)} ${n2(cy)} ` +
    `C ${n2(cx + r)} ${n2(cy + k)} ${n2(cx + k)} ${n2(cy + r)} ${n2(cx)} ${n2(cy + r)} ` +
    `C ${n2(cx - k)} ${n2(cy + r)} ${n2(cx - r)} ${n2(cy + k)} ${n2(cx - r)} ${n2(cy)} Z`
  );
};

/** Columna: punta de arriba redondeada, base recta. */
const columna = (x: number, arriba: number, ancho: number, base: number) => {
  const r = Math.min(4, ancho / 2, base - arriba);
  return (
    `M ${n2(x)} ${n2(base)} L ${n2(x)} ${n2(arriba + r)} Q ${n2(x)} ${n2(arriba)} ${n2(x + r)} ${n2(arriba)} ` +
    `L ${n2(x + ancho - r)} ${n2(arriba)} Q ${n2(x + ancho)} ${n2(arriba)} ${n2(x + ancho)} ${n2(arriba + r)} ` +
    `L ${n2(x + ancho)} ${n2(base)} Z`
  );
};

/** Barra acostada: punta derecha redondeada, base (izquierda) recta. */
const barra = (x: number, y: number, largo: number, alto: number) => {
  const r = Math.min(4, alto / 2, largo);
  return (
    `M ${n2(x)} ${n2(y)} L ${n2(x + largo - r)} ${n2(y)} Q ${n2(x + largo)} ${n2(y)} ${n2(x + largo)} ${n2(y + r)} ` +
    `L ${n2(x + largo)} ${n2(y + alto - r)} Q ${n2(x + largo)} ${n2(y + alto)} ${n2(x + largo - r)} ${n2(y + alto)} ` +
    `L ${n2(x)} ${n2(y + alto)} Z`
  );
};

const LETRA_EJE = 11;
const LETRA_VALOR = 11;

/** Gráficos en el tiempo: columnas o líneas sobre un eje de valores. */
function enElTiempo(b: BloqueGrafico, ancho: number): Escena {
  const formas: Forma[] = [];
  const textos: Texto[] = [];
  const zonas: Zona[] = [];
  const n = b.categorias.length;
  const k = b.series.length;
  const esLineas = b.tipo === "lineas";

  const maximo = Math.max(0, ...b.series.flatMap((s) => s.valores.map((v) => v ?? 0)));
  const marcas = b.unidad === "%" ? [0, 25, 50, 75, 100] : escalones(maximo, b.unidad === "");
  const tope = marcas[marcas.length - 1];

  const alto = 210;
  const arriba = 18;
  const abajo = 24;
  const izquierda = Math.ceil(Math.max(...marcas.map((m) => anchoTexto(decirEje(m), LETRA_EJE)))) + 10;

  // Rótulo del último valor de cada línea, si no se pisan entre sí.
  const ultimos = b.series.map((s) => {
    for (let i = n - 1; i >= 0; i--) if (s.valores[i] !== null) return { i, v: s.valores[i] as number };
    return null;
  });
  const yDe = (v: number, altoTrazo: number) => arriba + altoTrazo * (1 - v / tope);
  const altoTrazo = alto - arriba - abajo;
  const finales = ultimos.flatMap((u) => (u ? [yDe(u.v, altoTrazo)] : []));
  const seEnciman = finales.some((y, i) => finales.some((otro, j) => j > i && Math.abs(otro - y) < 13));
  const rotularFinal = esLineas && !seEnciman;
  const derecha = rotularFinal
    ? Math.ceil(Math.max(0, ...ultimos.map((u) => (u ? anchoTexto(decirValor(u.v, b.unidad), LETRA_VALOR) : 0)))) + 14
    : 10;

  const anchoTrazo = Math.max(40, ancho - izquierda - derecha);
  const base = arriba + altoTrazo;
  const banda = anchoTrazo / Math.max(1, n);

  // Grilla y eje de valores.
  for (const marca of marcas) {
    const y = n2(yDe(marca, altoTrazo));
    formas.push({ d: `M ${izquierda} ${y} L ${n2(izquierda + anchoTrazo)} ${y}`, trazo: marca === 0 ? "eje" : "grilla", grosor: 1 });
    textos.push({ x: izquierda - 6, y: y + 4, texto: decirEje(marca), tam: LETRA_EJE, ancla: "fin", tono: "tenue" });
  }

  // Rótulos del eje de tiempo: se saltean los que no entran.
  const masLargo = Math.max(...b.categorias.map((c) => anchoTexto(c, LETRA_EJE)), 1);
  const cada = Math.max(1, Math.ceil((masLargo + 8) / banda));
  b.categorias.forEach((cat, i) => {
    if (i % cada !== 0) return;
    textos.push({ x: n2(izquierda + banda * (i + 0.5)), y: base + 16, texto: cat, tam: LETRA_EJE, ancla: "medio", tono: "tenue" });
  });

  if (esLineas) {
    b.series.forEach((s, j) => {
      const tono = tonoDe(s.medida);
      const puntos = s.valores.map((v, i) => (v === null ? null : { x: izquierda + banda * (i + 0.5), y: yDe(v, altoTrazo) }));
      // Un tramo por cada seguidilla de valores: donde no hay dato, la línea se corta.
      let tramo = "";
      puntos.forEach((p, i) => {
        if (!p) return;
        tramo += `${puntos[i - 1] ? "L" : "M"} ${n2(p.x)} ${n2(p.y)} `;
      });
      if (tramo) formas.push({ d: tramo.trim(), trazo: tono, grosor: 2 });
      const conPunto = (i: number) => n <= 16 || i === ultimos[j]?.i || (!puntos[i - 1] && !puntos[i + 1]);
      puntos.forEach((p, i) => {
        if (p && conPunto(i)) formas.push({ d: circulo(p.x, p.y, 4), relleno: tono, trazo: "superficie", grosor: 2 });
      });
      const u = ultimos[j];
      if (u && rotularFinal) {
        textos.push({
          // Si el punto está sobre el eje, el rótulo sube un poco para no pisarlo.
          x: n2(izquierda + banda * (u.i + 0.5) + 9), y: n2(Math.min(yDe(u.v, altoTrazo) + 4, base - 6)),
          texto: decirValor(u.v, b.unidad), tam: LETRA_VALOR, ancla: "inicio", tono: "texto",
        });
      }
    });
  } else {
    const separacion = 2;
    const anchoBarra = Math.max(2, Math.min(24, (banda * 0.72 - separacion * (k - 1)) / k));
    const grupo = anchoBarra * k + separacion * (k - 1);
    // Con pocas columnas se rotulan todas; si no, solo la más alta de cada serie.
    const rotularTodo = n * k <= 14;
    b.series.forEach((s, j) => {
      const tono = tonoDe(s.medida);
      const mayor = Math.max(...s.valores.map((v) => v ?? 0));
      const indiceMayor = s.valores.findIndex((v) => v === mayor);
      s.valores.forEach((v, i) => {
        if (v === null || v <= 0) return;
        const x = izquierda + banda * (i + 0.5) - grupo / 2 + j * (anchoBarra + separacion);
        const y = yDe(v, altoTrazo);
        formas.push({ d: columna(x, y, anchoBarra, base), relleno: tono });
        if (rotularTodo || i === indiceMayor) {
          textos.push({ x: n2(x + anchoBarra / 2), y: n2(y - 5), texto: decirValor(v, b.unidad === "días" ? "" : b.unidad), tam: 10, ancla: "medio", tono: "texto2" });
        }
      });
    });
  }

  b.categorias.forEach((cat, i) => {
    zonas.push({
      x: n2(izquierda + banda * i), y: arriba - 6, ancho: n2(banda), alto: altoTrazo + 6,
      titulo: cat,
      filas: b.series.map((s) => ({ nombre: s.nombre, valor: decirValor(s.valores[i], b.unidad), tono: tonoDe(s.medida) })),
    });
  });

  return { ancho, alto, formas, textos, zonas };
}

/** Por proyecto, área o prioridad: barras acostadas, una fila por categoría, con el valor en la punta. */
function porCategoria(b: BloqueGrafico, ancho: number): Escena {
  const formas: Forma[] = [];
  const textos: Texto[] = [];
  const zonas: Zona[] = [];
  const k = b.series.length;
  const esReparto = b.tipo === "reparto";
  const total = esReparto ? b.series[0].valores.reduce((s: number, v) => s + (v ?? 0), 0) : 0;

  const decir = (v: number | null) => {
    if (!esReparto || v === null) return decirValor(v, b.unidad);
    return `${decirValor(v, "")} · ${total ? Math.round((v / total) * 100) : 0} %`;
  };

  // En pantallas angostas el nombre va arriba de la barra en lugar de al costado.
  const apilado = ancho < 460;
  const LETRA_NOMBRE = 12;
  const altoBarra = k === 1 ? 14 : 10;
  const separacion = 2;
  const altoBarras = altoBarra * k + separacion * (k - 1);
  const altoFila = (apilado ? 18 : 0) + altoBarras + 12;

  const anchoValor = Math.ceil(Math.max(...b.series.flatMap((s) => s.valores.map((v) => anchoTexto(decir(v), LETRA_VALOR))), 10)) + 10;
  // La columna de nombres mide lo que el nombre más largo (hasta un tercio del ancho) más un respiro.
  const RESPIRO_NOMBRE = 12;
  const anchoNombre = apilado
    ? 0
    : Math.ceil(Math.min(ancho * 0.36, Math.max(...b.categorias.map((c) => anchoTexto(c, LETRA_NOMBRE)), 20))) + RESPIRO_NOMBRE;
  const x0 = anchoNombre;
  const largoMaximo = Math.max(20, ancho - x0 - anchoValor);
  const maximo = b.unidad === "%" ? 100 : Math.max(1, ...b.series.flatMap((s) => s.valores.map((v) => v ?? 0)));
  const alto = Math.max(altoFila, b.categorias.length * altoFila) + 4;

  // La base de las barras.
  formas.push({ d: `M ${x0} 0 L ${x0} ${alto - 4}`, trazo: "eje", grosor: 1 });

  b.categorias.forEach((cat, i) => {
    const arriba = i * altoFila + 2;
    const yBarras = arriba + (apilado ? 18 : 4);
    if (apilado) {
      textos.push({ x: 0, y: arriba + 12, texto: recortar(cat, ancho - 4, LETRA_NOMBRE), tam: LETRA_NOMBRE, ancla: "inicio", tono: "texto2" });
    } else {
      textos.push({
        x: x0 - 10, y: n2(yBarras + altoBarras / 2 + 4),
        texto: recortar(cat, anchoNombre - RESPIRO_NOMBRE, LETRA_NOMBRE), tam: LETRA_NOMBRE, ancla: "fin", tono: "texto2",
      });
    }
    b.series.forEach((s, j) => {
      const v = s.valores[i];
      const y = yBarras + j * (altoBarra + separacion);
      const largo = v === null ? 0 : (largoMaximo * v) / maximo;
      if (largo > 0.5) formas.push({ d: barra(x0, y, largo, altoBarra), relleno: tonoDe(s.medida) });
      textos.push({
        x: n2(x0 + Math.max(0, largo) + 6), y: n2(y + altoBarra / 2 + 4),
        texto: decir(v), tam: k === 1 ? LETRA_VALOR : 10, ancla: "inicio", tono: "texto",
      });
    });
    zonas.push({
      x: 0, y: arriba, ancho, alto: altoFila, titulo: cat,
      filas: b.series.map((s) => ({ nombre: s.nombre, valor: decir(s.valores[i]), tono: tonoDe(s.medida) })),
    });
  });

  return { ancho, alto, formas, textos, zonas };
}

/** En el eje, los miles se abrevian; el resto va tal cual. */
function decirEje(v: number): string {
  if (v >= 10_000) return `${n2(v / 1000)}K`.replace(".", ",");
  return String(v).replace(".", ",");
}

/** La escena de un gráfico para un ancho dado (en puntos o píxeles: es lo mismo). */
export function escenaDe(b: BloqueGrafico, ancho: number): Escena {
  return GRUPOS_DE_TIEMPO.includes(b.agrupar) ? enElTiempo(b, ancho) : porCategoria(b, ancho);
}

/** ¿Hay algo que dibujar? Un gráfico sin categorías o todo en cero muestra un aviso en su lugar. */
export function graficoVacio(b: BloqueGrafico): boolean {
  return !b.categorias.length || b.series.every((s) => s.valores.every((v) => v === null || v === 0));
}
