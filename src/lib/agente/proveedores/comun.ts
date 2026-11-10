import { ErrorProveedor } from "../tipos";

/**
 * fetch con dos relojes: uno hasta que llega la respuesta (un proveedor caído
 * o una computadora apagada se descartan rápido) y otro para toda la respuesta.
 */
export async function pedir(
  proveedor: string,
  url: string,
  init: RequestInit,
  { primerByteMs, totalMs, senal }: { primerByteMs: number; totalMs: number; senal?: AbortSignal },
): Promise<Response> {
  const control = new AbortController();
  const alAbortar = () => control.abort();
  senal?.addEventListener("abort", alAbortar, { once: true });
  const relojInicio = setTimeout(() => control.abort(), primerByteMs);
  const relojTotal = setTimeout(() => control.abort(), totalMs);

  let respuesta: Response;
  try {
    respuesta = await fetch(url, { ...init, signal: control.signal });
  } catch (error) {
    clearTimeout(relojTotal);
    if (senal?.aborted) throw error;
    throw new ErrorProveedor(proveedor, "sin_respuesta", `${proveedor} no respondió`);
  } finally {
    clearTimeout(relojInicio);
  }

  if (!respuesta.ok) {
    clearTimeout(relojTotal);
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
    const clase =
      respuesta.status === 429 ? "limite" : respuesta.status >= 500 ? "sin_respuesta" : "otro";
    throw new ErrorProveedor(proveedor, clase, `${proveedor} respondió ${respuesta.status}: ${detalle}`);
  }
  // El reloj total sigue corriendo mientras se lee el cuerpo; abortar algo ya
  // terminado no hace nada. unref evita que mantenga vivo el proceso.
  (relojTotal as { unref?: () => void }).unref?.();
  return respuesta;
}

/** Lee un cuerpo en streaming línea por línea. */
export async function* lineas(proveedor: string, respuesta: Response): AsyncGenerator<string> {
  if (!respuesta.body) throw new ErrorProveedor(proveedor, "invalido", "Respuesta sin cuerpo");
  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      pendiente += decodificador.decode(value, { stream: true });
      let corte: number;
      while ((corte = pendiente.indexOf("\n")) !== -1) {
        const linea = pendiente.slice(0, corte).trim();
        pendiente = pendiente.slice(corte + 1);
        if (linea) yield linea;
      }
    }
  } catch (error) {
    if (error instanceof ErrorProveedor) throw error;
    throw new ErrorProveedor(proveedor, "sin_respuesta", `${proveedor} cortó la respuesta`);
  }
  if (pendiente.trim()) yield pendiente.trim();
}

/** Los eventos `data: {...}` de un stream SSE, ya parseados. */
export async function* eventosSSE(proveedor: string, respuesta: Response): AsyncGenerator<unknown> {
  for await (const linea of lineas(proveedor, respuesta)) {
    if (!linea.startsWith("data:")) continue;
    const dato = linea.slice(5).trim();
    if (dato === "[DONE]") return;
    try {
      yield JSON.parse(dato);
    } catch {
      throw new ErrorProveedor(proveedor, "invalido", "Respuesta mal formada");
    }
  }
}

export function comoObjeto(texto: unknown): unknown {
  if (typeof texto !== "string") return texto ?? {};
  try {
    return JSON.parse(texto || "{}");
  } catch {
    // Se deja pasar: la validación de argumentos lo va a rechazar con un mensaje claro.
    return { _argumentos_ilegibles: texto.slice(0, 200) };
  }
}
