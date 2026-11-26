import { closestCorners, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/**
 * Dónde cae una tarjeta del Tablero al soltarla.
 *
 * Con el mouse o el dedo manda lo que está debajo: una tarjeta antes que su
 * columna y, en la parte vacía de una columna, la columna. Si se suelta fuera
 * de todas, no cae en ninguna y vuelve a su lugar.
 *
 * Antes se usaba solo `closestCorners`, que promedia la distancia a las cuatro
 * esquinas. Las columnas se estiran al alto de la más larga: con muchas
 * tarjetas, las esquinas de abajo de una columna vacía quedaban tan lejos que
 * ganaba una tarjeta de la columna de origen, y la tarjeta volvía a su lugar.
 *
 * Con el teclado no hay puntero: ahí sigue `closestCorners`, que es lo que
 * esperan las flechas de las listas ordenables.
 */
export function dondeCae(columnas: readonly string[]): CollisionDetection {
  return (args) => {
    if (!args.pointerCoordinates) return closestCorners(args);
    const debajo = pointerWithin(args);
    const tarjeta = debajo.find((c) => !columnas.includes(String(c.id)));
    return tarjeta ? [tarjeta] : debajo;
  };
}
