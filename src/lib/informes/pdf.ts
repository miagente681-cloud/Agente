import { LineCapStyle, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { TEMA_PAPEL } from "./colores";
import { escenaDe, graficoVacio, leyendaDe, type Tono } from "./escena";
import { comparar, fechaCorta, motivoSinValor, periodoLegible, valorDe } from "./texto";
import type { BloqueCalculado, BloqueGrafico, BloqueLista, BloqueNumero, DatosInforme } from "./tipos";

/**
 * El informe como PDF. Corre en el navegador (y en las pruebas, en Node): no
 * hay servidor de por medio. Usa la misma escena que la pantalla para los
 * gráficos, en colores de papel.
 *
 * Tipografía: Helvetica, que todo lector de PDF trae. Solo tiene el alfabeto
 * latino: lo que no puede escribir (emojis, flechas) se saca del texto en
 * lugar de romper el documento.
 */

export type InformeParaPdf = { titulo: string; analisis: string | null; creado: string; datos: DatosInforme };

const ANCHO = 595.28; // A4, en puntos
const ALTO = 841.89;
const MARGEN = 42;
const UTIL = ANCHO - MARGEN * 2;
const PIE = 34;

const color = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const TINTA: Record<Tono, RGB> = Object.fromEntries(
  (Object.keys(TEMA_PAPEL) as Tono[]).map((t) => [t, color(TEMA_PAPEL[t])]),
) as Record<Tono, RGB>;
/** Para «mejor» y «peor» que el período anterior. Siempre con el signo al lado: nunca solo el color. */
const VERDE = color("#006300");
const ROJO = color("#b3261e");

export async function armarPdf(informe: InformeParaPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const letras = new Set(normal.getCharacterSet());

  /** Deja solo lo que la tipografía puede escribir. */
  const limpio = (texto: string) =>
    Array.from(texto.replace(/\s+/g, " "))
      // El signo menos tipográfico no está en esta tipografía: sin esto «−2» quedaría «2».
      .map((c) => (c === "−" ? "-" : c === "→" ? "->" : c))
      .join("")
      .split("")
      .filter((c) => letras.has(c.codePointAt(0) as number))
      .join("")
      .trim();

  const titulo = limpio(informe.titulo) || "Informe";
  doc.setTitle(titulo);
  doc.setCreator("MiAgente");
  doc.setCreationDate(new Date(informe.creado));

  let pagina: PDFPage = doc.addPage([ANCHO, ALTO]);
  /** Posición de escritura, medida desde arriba de la página. */
  let y = MARGEN;

  const nuevaPagina = () => {
    pagina = doc.addPage([ANCHO, ALTO]);
    y = MARGEN;
  };
  /** Si no entra lo que sigue, pasa de página. Devuelve si hubo salto. */
  const asegurar = (alto: number) => {
    if (y + alto <= ALTO - MARGEN - PIE) return false;
    nuevaPagina();
    return true;
  };

  const escribir = (
    texto: string,
    x: number,
    lineaBase: number,
    o: { tam: number; tinta?: RGB; fuente?: PDFFont; ancla?: "inicio" | "medio" | "fin" },
  ) => {
    const fuente = o.fuente ?? normal;
    const t = limpio(texto);
    if (!t) return;
    const ancho = fuente.widthOfTextAtSize(t, o.tam);
    const dx = o.ancla === "fin" ? -ancho : o.ancla === "medio" ? -ancho / 2 : 0;
    pagina.drawText(t, { x: x + dx, y: ALTO - lineaBase, size: o.tam, font: fuente, color: o.tinta ?? TINTA.texto });
  };

  /** Parte un texto en renglones que entran en un ancho. */
  const renglones = (texto: string, anchoMaximo: number, tam: number, fuente: PDFFont = normal): string[] => {
    const lista: string[] = [];
    let actual = "";
    for (const palabra of limpio(texto).split(" ")) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (fuente.widthOfTextAtSize(prueba, tam) <= anchoMaximo || !actual) actual = prueba;
      else {
        lista.push(actual);
        actual = palabra;
      }
    }
    if (actual) lista.push(actual);
    return lista;
  };
  /** Un texto en un solo renglón: si no entra, se corta con puntos suspensivos. */
  const encajar = (texto: string, anchoMaximo: number, tam: number, fuente: PDFFont = normal): string => {
    let t = limpio(texto);
    if (fuente.widthOfTextAtSize(t, tam) <= anchoMaximo) return t;
    while (t.length > 1 && fuente.widthOfTextAtSize(t + "…", tam) > anchoMaximo) t = t.slice(0, -1);
    return t.trimEnd() + "…";
  };
  const parrafo = (texto: string, o: { tam: number; interlinea: number; tinta?: RGB; fuente?: PDFFont; ancho?: number }) => {
    for (const renglon of renglones(texto, o.ancho ?? UTIL, o.tam, o.fuente)) {
      asegurar(o.interlinea);
      escribir(renglon, MARGEN, y + o.tam, o);
      y += o.interlinea;
    }
  };
  const raya = (desdeArriba: number, tinta: RGB = TINTA.grilla) =>
    pagina.drawLine({ start: { x: MARGEN, y: ALTO - desdeArriba }, end: { x: MARGEN + UTIL, y: ALTO - desdeArriba }, thickness: 0.75, color: tinta });

  // --- Encabezado ---------------------------------------------------------------
  escribir("MiAgente · Informe", MARGEN, y + 9, { tam: 9, tinta: TINTA.tenue });
  y += 22;
  parrafo(titulo, { tam: 20, interlinea: 25, fuente: negrita });
  y += 2;
  parrafo(periodoLegible(informe.datos.desde, informe.datos.hasta) + (informe.datos.filtro ? ` · ${informe.datos.filtro}` : ""), {
    tam: 11, interlinea: 16, tinta: TINTA.texto2,
  });
  y += 8;
  raya(y);
  y += 18;

  if (informe.analisis) {
    escribir("LECTURA DEL AGENTE", MARGEN, y + 8, { tam: 8, tinta: TINTA.tenue, fuente: negrita });
    y += 16;
    parrafo(informe.analisis, { tam: 10.5, interlinea: 15.5 });
    y += 14;
  }

  // --- Bloques --------------------------------------------------------------------
  const numeros = (fila: BloqueNumero[]) => {
    const ALTO_FICHA = 66;
    const separacion = 10;
    asegurar(ALTO_FICHA + 14);
    const ancho = (UTIL - separacion * (fila.length - 1)) / fila.length;
    fila.forEach((b, i) => {
      const x = MARGEN + i * (ancho + separacion);
      pagina.drawRectangle({ x, y: ALTO - y - ALTO_FICHA, width: ancho, height: ALTO_FICHA, borderColor: TINTA.grilla, borderWidth: 0.75 });
      escribir(encajar(b.titulo, ancho - 20, 9), x + 10, y + 17, { tam: 9, tinta: TINTA.texto2 });
      escribir(valorDe(b), x + 10, y + 41, { tam: 19, fuente: negrita });
      const c = comparar(b);
      const nota = c ? `${c.texto} vs. período anterior` : motivoSinValor(b);
      if (nota) {
        escribir(encajar(nota, ancho - 20, 8), x + 10, y + 56, {
          tam: 8, tinta: c?.sentido === "bien" ? VERDE : c?.sentido === "mal" ? ROJO : TINTA.tenue,
        });
      }
    });
    y += ALTO_FICHA + 16;
  };

  const grafico = (b: BloqueGrafico) => {
    const vacio = graficoVacio(b);
    const escena = vacio ? null : escenaDe(b, UTIL);
    const leyenda = leyendaDe(b);
    const altoLeyenda = leyenda.length > 1 ? 18 : 0;
    asegurar(24 + altoLeyenda + (escena?.alto ?? 20) + 10);
    escribir(encajar(b.titulo, UTIL, 12, negrita), MARGEN, y + 12, { tam: 12, fuente: negrita });
    y += 22;
    if (leyenda.length > 1) {
      let x = MARGEN;
      for (const l of leyenda) {
        pagina.drawRectangle({ x, y: ALTO - y - 8, width: 8, height: 8, color: TINTA[l.tono] });
        escribir(l.nombre, x + 12, y + 8, { tam: 9, tinta: TINTA.texto2 });
        x += 12 + normal.widthOfTextAtSize(limpio(l.nombre), 9) + 16;
      }
      y += altoLeyenda;
    }
    if (!escena) {
      escribir("No hay nada para mostrar en este período.", MARGEN, y + 10, { tam: 10, tinta: TINTA.tenue });
      y += 30;
      return;
    }
    for (const f of escena.formas) {
      pagina.drawSvgPath(f.d, {
        x: MARGEN,
        y: ALTO - y,
        color: f.relleno ? TINTA[f.relleno] : undefined,
        borderColor: f.trazo ? TINTA[f.trazo] : undefined,
        borderWidth: f.trazo ? (f.grosor ?? 1) * (f.trazo === "grilla" || f.trazo === "eje" ? 0.75 : 1) : 0,
        borderLineCap: LineCapStyle.Round,
      });
    }
    for (const t of escena.textos) {
      escribir(t.texto, MARGEN + t.x, y + t.y, { tam: t.tam, tinta: TINTA[t.tono], ancla: t.ancla });
    }
    y += escena.alto + 20;
  };

  const lista = (b: BloqueLista) => {
    const conAnio = new Set(b.filas.map((f) => f.fecha?.slice(0, 4))).size > 1;
    const xFecha = MARGEN;
    const xTitulo = MARGEN + (conAnio ? 62 : 46);
    const anchoDetalle = 84;
    const anchoProyecto = 118;
    const xDetalle = MARGEN + UTIL;
    const xProyecto = xDetalle - anchoDetalle - anchoProyecto;
    const anchoTitulo = xProyecto - xTitulo - 12;

    const encabezado = () => {
      escribir("Fecha", xFecha, y + 8, { tam: 8, tinta: TINTA.tenue, fuente: negrita });
      escribir("Tarea", xTitulo, y + 8, { tam: 8, tinta: TINTA.tenue, fuente: negrita });
      escribir("Proyecto", xProyecto, y + 8, { tam: 8, tinta: TINTA.tenue, fuente: negrita });
      escribir(b.columna, xDetalle, y + 8, { tam: 8, tinta: TINTA.tenue, fuente: negrita, ancla: "fin" });
      y += 13;
      raya(y, TINTA.eje);
      y += 4;
    };

    asegurar(22 + 17 + 20);
    escribir(encajar(`${b.titulo} · ${b.total}`, UTIL, 12, negrita), MARGEN, y + 12, { tam: 12, fuente: negrita });
    y += 24;
    if (!b.filas.length) {
      escribir("Ninguna en este período.", MARGEN, y + 10, { tam: 10, tinta: TINTA.tenue });
      y += 30;
      return;
    }
    encabezado();
    for (const f of b.filas) {
      // El título puede ocupar dos renglones; lo que no entra se corta.
      const partes = renglones(f.titulo, anchoTitulo, 9.5);
      const lineas = partes.length > 2 ? [partes[0], encajar(partes.slice(1).join(" "), anchoTitulo, 9.5)] : partes;
      const alto = 8 + lineas.length * 12;
      if (asegurar(alto + 2)) encabezado();
      escribir(f.fecha ? fechaCorta(f.fecha, conAnio) : "—", xFecha, y + 12, { tam: 9, tinta: TINTA.texto2 });
      lineas.forEach((l, i) => escribir(l, xTitulo, y + 12 + i * 12, { tam: 9.5 }));
      escribir(encajar(f.proyecto, anchoProyecto - 8, 9), xProyecto, y + 12, { tam: 9, tinta: TINTA.texto2 });
      escribir(encajar(f.detalle, anchoDetalle, 9), xDetalle, y + 12, { tam: 9, tinta: TINTA.texto2, ancla: "fin" });
      y += alto;
      raya(y);
    }
    if (b.total > b.filas.length) {
      y += 6;
      escribir(`Se muestran las primeras ${b.filas.length} de ${b.total}.`, MARGEN, y + 9, { tam: 8.5, tinta: TINTA.tenue });
      y += 10;
    }
    y += 20;
  };

  // Los números seguidos van en una misma fila, de a cuatro como mucho.
  const pendientes: BloqueNumero[] = [];
  const volcarNumeros = () => {
    while (pendientes.length) numeros(pendientes.splice(0, 4));
  };
  for (const b of informe.datos.bloques as BloqueCalculado[]) {
    if (b.tipo === "numero") {
      pendientes.push(b);
      continue;
    }
    volcarNumeros();
    if (b.tipo === "lista") lista(b);
    else grafico(b);
  }
  volcarNumeros();

  // --- Nota al pie del informe -----------------------------------------------------
  const armado = new Date(informe.creado).toLocaleString("es-UY", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  parrafo(
    `Armado el ${armado}. Los números son de ese momento. Cuentan las tareas principales (no las subtareas). ` +
      "La puntualidad compara el día en que se terminó cada tarea con su fecha límite.",
    { tam: 8.5, interlinea: 12, tinta: TINTA.tenue },
  );

  // --- Pie de cada página ----------------------------------------------------------
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    pagina = p;
    const base = ALTO - MARGEN + 6;
    escribir(encajar(`MiAgente · ${titulo}`, UTIL - 90, 8), MARGEN, base, { tam: 8, tinta: TINTA.tenue });
    escribir(`Página ${i + 1} de ${paginas.length}`, MARGEN + UTIL, base, { tam: 8, tinta: TINTA.tenue, ancla: "fin" });
  });

  return doc.save();
}
