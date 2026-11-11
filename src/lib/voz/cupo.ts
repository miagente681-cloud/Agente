/** Cupo mensual gratuito de Azure Speech (nivel F0). Se puede ajustar por variables de entorno. */
export type Cupos = { sttSegundos: number; ttsCaracteres: number };
export const CUPOS_F0: Cupos = { sttSegundos: 5 * 3600, ttsCaracteres: 500_000 };
/** Margen para no pasarse: lo que se reporta desde el navegador llega con unos segundos de atraso. */
const RESERVA = 0.98;

export function cuposDe(env: Record<string, string | undefined>): Cupos {
  const numero = (v: string | undefined, defecto: number) => (Number(v) > 0 ? Number(v) : defecto);
  return {
    sttSegundos: numero(env.AZURE_CUPO_STT_SEGUNDOS, CUPOS_F0.sttSegundos),
    ttsCaracteres: numero(env.AZURE_CUPO_TTS_CARACTERES, CUPOS_F0.ttsCaracteres),
  };
}

/** Qué tan lleno está el cupo: manda el que esté más cerca del tope, sea escucha o voz. */
export function evaluarCupo(uso: { stt_seconds: number; tts_chars: number } | null, cupos: Cupos) {
  const stt = (uso?.stt_seconds ?? 0) / cupos.sttSegundos;
  const tts = (uso?.tts_chars ?? 0) / cupos.ttsCaracteres;
  const mayor = Math.max(stt, tts);
  return {
    porcentaje: Math.min(100, Math.round(mayor * 100)),
    /** Aviso desde el 90 %. */
    aviso: mayor >= 0.9,
    /** Agotado: Azure deja de entregarse y la llamada sigue con el navegador o por texto. */
    agotado: mayor >= RESERVA,
    stt: Math.min(100, Math.round(stt * 100)),
    tts: Math.min(100, Math.round(tts * 100)),
  };
}

/**
 * Lo que descuenta cada token de Azure al entregarse, se informe o no el uso
 * después: el navegador podría no informarlo. Un token dura 10 minutos.
 */
export const MINIMO_POR_TOKEN = { sttSegundos: 60, ttsCaracteres: 1500 };

export function minimoPorTokenDe(env: Record<string, string | undefined>) {
  const numero = (v: string | undefined, defecto: number) => (v !== undefined && v.trim() !== "" && Number(v) >= 0 ? Number(v) : defecto);
  return {
    sttSegundos: numero(env.AZURE_MINIMO_STT_POR_TOKEN, MINIMO_POR_TOKEN.sttSegundos),
    ttsCaracteres: numero(env.AZURE_MINIMO_TTS_POR_TOKEN, MINIMO_POR_TOKEN.ttsCaracteres),
  };
}
