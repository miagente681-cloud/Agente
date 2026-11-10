import type { AlTexto, ProveedorVoz, RespuestaToken } from "./tipos";

type TokenAzure = Extract<RespuestaToken, { azure: true }>;

/** Los tokens duran 10 minutos; se renuevan antes. */
const RENOVAR_CADA_MS = 8 * 60_000;

export class CupoAgotado extends Error {}

/**
 * Voz con Azure AI Speech. El navegador nunca ve la clave: usa tokens cortos
 * que entrega el servidor. Para estirar las 5 horas gratis, el micrófono solo
 * se envía a Azure mientras se está escuchando (no mientras habla el Agente).
 */
export async function crearVozAzure(p: {
  inicial: TokenAzure;
  pedirToken: () => Promise<RespuestaToken>;
  /** null: sin micrófono, solo se usa para hablar. */
  microfono: MediaStream | null;
  /** Se llama si al renovar el token el servidor dice que se acabó el cupo. */
  alAgotarse: () => void;
}): Promise<ProveedorVoz> {
  // El SDK pesa: se carga recién al entrar a una llamada.
  const sdk = await import("microsoft-cognitiveservices-speech-sdk");
  const config = sdk.SpeechConfig.fromAuthorizationToken(p.inicial.token, p.inicial.region);
  config.speechRecognitionLanguage = "es-UY";
  config.speechSynthesisVoiceName = p.inicial.voz;

  const reconocedor = p.microfono
    ? new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromStreamInput(p.microfono))
    : null;
  let escuchandoDesde: number | null = null;
  let acumulado = 0;
  let sonando: { destino: InstanceType<typeof sdk.SpeakerAudioDestination>; terminar: () => void } | null = null;
  let cerrado = false;

  const renovacion = setInterval(async () => {
    const nuevo = await p.pedirToken().catch(() => null);
    if (cerrado) return;
    if (nuevo?.azure) {
      config.authorizationToken = nuevo.token;
      if (reconocedor) reconocedor.authorizationToken = nuevo.token;
    } else if (nuevo && nuevo.motivo === "agotado") {
      p.alAgotarse();
    }
  }, RENOVAR_CADA_MS);

  const cortarCuenta = () => {
    if (escuchandoDesde !== null) {
      acumulado += (Date.now() - escuchandoDesde) / 1000;
      escuchandoDesde = null;
    }
  };

  const callar = () => {
    const actual = sonando;
    if (!actual) return;
    actual.destino.pause();
    actual.destino.close();
    actual.terminar();
  };

  return {
    id: "azure",

    escuchar(alTexto: AlTexto, alError) {
      if (!reconocedor) {
        alError("El micrófono no está activado.");
        return Promise.resolve();
      }
      reconocedor.recognizing = (_s, e) => {
        if (e.result.text) alTexto(e.result.text, false);
      };
      reconocedor.recognized = (_s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text.trim()) alTexto(e.result.text.trim(), true);
      };
      reconocedor.canceled = (_s, e) => {
        if (e.reason === sdk.CancellationReason.Error) {
          cortarCuenta();
          alError("Se cortó el reconocimiento de voz de Azure.");
        }
      };
      return new Promise<void>((listo) => {
        if (escuchandoDesde !== null) return listo();
        reconocedor.startContinuousRecognitionAsync(
          () => {
            escuchandoDesde = Date.now();
            listo();
          },
          () => {
            alError("No se pudo iniciar el reconocimiento de voz de Azure.");
            listo();
          },
        );
      });
    },

    pausar() {
      return new Promise<void>((listo) => {
        if (escuchandoDesde === null || !reconocedor) return listo();
        cortarCuenta();
        reconocedor.stopContinuousRecognitionAsync(() => listo(), () => listo());
      });
    },

    hablar(texto) {
      return new Promise<void>((listo) => {
        const destino = new sdk.SpeakerAudioDestination();
        const sintetizador = new sdk.SpeechSynthesizer(config, sdk.AudioConfig.fromSpeakerOutput(destino));
        let termino = false;
        const terminar = () => {
          if (termino) return;
          termino = true;
          if (sonando?.destino === destino) sonando = null;
          listo();
        };
        sonando = { destino, terminar };
        destino.onAudioEnd = terminar;
        sintetizador.speakTextAsync(
          texto,
          (resultado) => {
            sintetizador.close();
            // Si no se generó audio (error o texto vacío) no va a llegar onAudioEnd.
            if (resultado.reason !== sdk.ResultReason.SynthesizingAudioCompleted) terminar();
          },
          () => {
            sintetizador.close();
            terminar();
          },
        );
      });
    },

    callar,

    cerrar() {
      cerrado = true;
      clearInterval(renovacion);
      cortarCuenta();
      callar();
      reconocedor?.stopContinuousRecognitionAsync(
        () => reconocedor.close(),
        () => reconocedor.close(),
      );
    },

    segundosNuevos() {
      // Lo que va de la escucha actual también cuenta.
      if (escuchandoDesde !== null) {
        acumulado += (Date.now() - escuchandoDesde) / 1000;
        escuchandoDesde = Date.now();
      }
      const enteros = Math.floor(acumulado);
      acumulado -= enteros;
      return enteros;
    },
  };
}
