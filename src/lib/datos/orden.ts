/**
 * Orden manual con números fraccionarios: para poner algo entre dos vecinos se
 * usa el punto medio, así mover una tarjeta escribe una sola fila.
 */
export function ordenEntre(antes: number | null, despues: number | null): number {
  if (antes === null && despues === null) return Date.now() / 1000;
  if (antes === null) return (despues as number) - 1;
  if (despues === null) return antes + 1;
  return (antes + despues) / 2;
}

/**
 * Orden para insertar `id` en la posición `indice` de una lista ya ordenada.
 * Si `id` ya está en la lista, el índice se cuenta sin él.
 */
export function ordenEnPosicion(
  lista: { id: string; sort_order: number }[],
  id: string,
  indice: number,
): number {
  const resto = lista.filter((x) => x.id !== id);
  const i = Math.max(0, Math.min(indice, resto.length));
  return ordenEntre(resto[i - 1]?.sort_order ?? null, resto[i]?.sort_order ?? null);
}
