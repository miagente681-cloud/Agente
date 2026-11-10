import type { AlTexto, ProveedorVoz } from "./tipos";

/* Tipos mínimos de la Web Speech API (no están en lib.dom en todos los navegadores). */
type Resultado = { isFinal: boolean; 0: { transcript: string } };
type EventoResultado = { resultIndex: number; results: { length: number; [i: number]: Resultado } };
type Reconocedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: EventoResultado) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function claseReconocedor(): (new () => Reconocedor) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const navegadorEscucha = () => claseReconocedor() !== null;
export const navegadorHabla = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Voz con lo que trae el navegador (Web Speech API): gratis y sin cupo, con
 * peor calidad y soporte desparejo. Es la alternativa cuando no hay Azure o se
 * agotó el cupo del mes.
 */
export function crearVozNavegador(): ProveedorVoz {
  const Clase = claseReconocedor();
  let reconocedor: Reconocedor | null = null;
  let escuchando = false;

  function vozEnEspanol(): SpeechSynthesisVoice | null {
    const voces = window.speechSynthesis.getVoices();
    for (const idioma of ["es-UY", "es-AR", "es-419", "es-US", "es-MX", "es"]) {
      const voz = voces.find((v) => v.lang.replace("_", "-").startsWith(idioma));
      if (voz) return voz;
    }
    return null;
  }

  return {
    id: "navegador",

    async escuchar(alTexto: AlTexto, alError) {
      if (!Clase) return alError("Este navegador no reconoce voz. Pasá la llamada a texto.");
      escuchando = true;
      reconocedor?.abort();
      const r = new Clase();
      reconocedor = r;
      r.lang = "es-UY";
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const texto = e.results[i][0].transcript.trim();
          if (texto) alTexto(texto, e.results[i].isFinal);
        }
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          escuchando = false;
          alError("No tengo permiso para usar el micrófono.");
        }
      };
      // El navegador corta solo tras un silencio: se vuelve a arrancar.
      r.onend = () => {
        if (escuchando && reconocedor === r) {
          try {
            r.start();
          } catch {
            // Ya estaba arrancando.
          }
        }
      };
      try {
        r.start();
      } catch {
        // Ya estaba arrancado.
      }
    },

    async pausar() {
      escuchando = false;
      reconocedor?.abort();
      reconocedor = null;
    },

    hablar(texto) {
      return new Promise<void>((listo) => {
        if (!navegadorHabla()) return listo();
        const frase = new SpeechSynthesisUtterance(texto);
        const voz = vozEnEspanol();
        if (voz) frase.voice = voz;
        frase.lang = voz?.lang ?? "es-UY";
        frase.rate = 1.05;
        frase.onend = () => listo();
        frase.onerror = () => listo();
        window.speechSynthesis.speak(frase);
      });
    },

    callar() {
      if (navegadorHabla()) window.speechSynthesis.cancel();
    },

    cerrar() {
      escuchando = false;
      reconocedor?.abort();
      reconocedor = null;
      if (navegadorHabla()) window.speechSynthesis.cancel();
    },

    // El reconocimiento del navegador no gasta el cupo de Azure.
    segundosNuevos: () => 0,
  };
}
