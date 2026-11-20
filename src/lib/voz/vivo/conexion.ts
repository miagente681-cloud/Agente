import { leerMensaje, type EventoVivo } from "./protocolo";

/** La conexión con el servicio de voz en vivo. Solo transporta: no decide nada. */
export type Enchufe = {
  enviar: (mensaje: unknown) => void;
  cerrar: () => void;
};

export type AlEnchufe = {
  /** Se abrió el canal: ya se pueden mandar los ajustes. */
  abierto: () => void;
  eventos: (eventos: EventoVivo[]) => void;
  /** Se cerró sin que lo pidiéramos (o no llegó a abrirse). */
  cierre: (codigo: number, motivo: string) => void;
};

export function abrirEnchufe(url: string, al: AlEnchufe): Enchufe {
  let cerradoPorNosotros = false;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    // Dirección inválida o bloqueada por la política de la página.
    queueMicrotask(() => al.cierre(0, "No se pudo abrir la conexión"));
    return { enviar: () => undefined, cerrar: () => undefined };
  }
  // El servicio manda el JSON en tramas binarias.
  socket.binaryType = "arraybuffer";
  const decodificador = new TextDecoder();
  socket.onopen = () => al.abierto();
  socket.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
    let crudo: unknown;
    try {
      crudo = JSON.parse(typeof e.data === "string" ? e.data : decodificador.decode(e.data));
    } catch {
      return;
    }
    const eventos = leerMensaje(crudo);
    if (eventos.length) al.eventos(eventos);
  };
  socket.onclose = (e) => {
    if (!cerradoPorNosotros) al.cierre(e.code, e.reason || "");
  };
  return {
    enviar(mensaje) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(mensaje));
    },
    cerrar() {
      cerradoPorNosotros = true;
      try {
        socket.close(1000);
      } catch {
        // Ya estaba cerrada.
      }
    },
  };
}
