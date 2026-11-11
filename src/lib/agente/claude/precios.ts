/**
 * Modelos de Claude que se pueden elegir y su precio. Es el único lugar del
 * código con precios: el costo de cada pedido se calcula con esta tabla.
 *
 * Dólares por millón de tokens, verificados en la página oficial de precios
 * (platform.claude.com/docs/en/about-claude/pricing) el 11/11/2026.
 */

export type Precio = {
  entrada: number;
  salida: number;
  /** Escritura de caché con duración de 5 minutos. */
  cache5m: number;
  /** Escritura de caché con duración de 1 hora. */
  cache1h: number;
  lectura: number;
};

export type ModeloClaude = {
  id: string;
  nombre: string;
  precio: Precio;
  /** Haiku 5.5 cobra más cuando el pedido pasa de 100.000 tokens. */
  tramoLargo?: { desde: number; precio: Precio };
};

export const MODELOS_CLAUDE: ModeloClaude[] = [
  {
    id: "claude-haiku-5-5",
    nombre: "Claude Haiku 5.5",
    precio: { entrada: 0.1, salida: 0.5, cache5m: 0.125, cache1h: 0.2, lectura: 0.01 },
    tramoLargo: { desde: 100_000, precio: { entrada: 0.5, salida: 2.5, cache5m: 0.625, cache1h: 1, lectura: 0.05 } },
  },
  {
    id: "claude-sonnet-5-5",
    nombre: "Claude Sonnet 5.5",
    precio: { entrada: 2, salida: 10, cache5m: 2.5, cache1h: 4, lectura: 0.1 },
  },
  {
    id: "claude-opus-5-5",
    nombre: "Claude Opus 5.5",
    precio: { entrada: 4, salida: 20, cache5m: 5, cache1h: 8, lectura: 0.2 },
  },
];

export const modeloClaude = (id: string) => MODELOS_CLAUDE.find((m) => m.id === id);

export type UsoTokens = {
  entrada: number;
  salida: number;
  /** Escritura de caché de 5 minutos. */
  cache5m: number;
  /** Escritura de caché de 1 hora. */
  cache1h: number;
  lectura: number;
};

/**
 * Costo en dólares de un pedido. El tramo de Haiku se decide por el largo
 * total del pedido: entrada más lo escrito y lo leído del caché.
 */
export function costoUSD(modelo: string, uso: UsoTokens): number {
  const m = modeloClaude(modelo);
  if (!m) return 0;
  const largo = uso.entrada + uso.cache5m + uso.cache1h + uso.lectura;
  const p = m.tramoLargo && largo > m.tramoLargo.desde ? m.tramoLargo.precio : m.precio;
  const total =
    uso.entrada * p.entrada +
    uso.salida * p.salida +
    uso.cache5m * p.cache5m +
    uso.cache1h * p.cache1h +
    uso.lectura * p.lectura;
  return total / 1_000_000;
}
