/**
 * Corta la respuesta del modelo en pedazos para decir, a medida que llega.
 * La primera oración sale sola (así el Agente empieza a hablar cuanto antes) y
 * el resto en bloques: Azure gratis admite 20 síntesis por minuto, y una por
 * oración se las come enseguida.
 */
const BLOQUE_MINIMO = 140;
const PRIMERA_MINIMA = 12;

/** Saca lo que se ve bien escrito pero suena mal leído. */
export function paraVoz(texto: string): string {
  return texto
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#`>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export class Segmentador {
  private pendiente = "";
  private dijoLaPrimera = false;

  /** Recibe un pedazo de texto y devuelve lo que ya se puede decir. */
  agregar(texto: string): string[] {
    this.pendiente += texto;
    const listos: string[] = [];
    for (;;) {
      const corte = this.proximoCorte();
      if (corte === -1) break;
      listos.push(this.pendiente.slice(0, corte));
      this.pendiente = this.pendiente.slice(corte);
      this.dijoLaPrimera = true;
    }
    return listos.map(paraVoz).filter(Boolean);
  }

  /** Lo que quedó sin decir cuando el modelo terminó. */
  cerrar(): string[] {
    const resto = paraVoz(this.pendiente);
    this.pendiente = "";
    this.dijoLaPrimera = false;
    return resto ? [resto] : [];
  }

  private proximoCorte(): number {
    // Fin de oración: punto, signo o salto de línea, seguido de espacio.
    const fin = /[.!?…]+["')\]]*\s+|\n+/g;
    const minimo = this.dijoLaPrimera ? BLOQUE_MINIMO : PRIMERA_MINIMA;
    let m: RegExpExecArray | null;
    while ((m = fin.exec(this.pendiente))) {
      const hasta = m.index + m[0].length;
      // "1." o "Sr." no cierran una oración.
      if (/(?:^|\s)(?:\d+|Sr|Sra|Dr|Dra|etc)\.\s+$/.test(this.pendiente.slice(0, hasta))) continue;
      if (hasta >= minimo) return hasta;
    }
    return -1;
  }
}
