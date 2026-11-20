/**
 * En iPhone (Safari y la app instalada en la pantalla de inicio) una página
 * solo puede hacer sonar audio o hablar con la voz del navegador si el primer
 * intento ocurre dentro de un toque de la persona. En la llamada, el Agente
 * habla recién después de abrir el micrófono y esperar la respuesta del
 * servidor: para entonces el toque ya "venció" y el iPhone descarta la voz sin
 * avisar. Esto se llama de forma sincrónica al tocar (antes de cualquier
 * `await`) y deja el audio habilitado para el resto de la página.
 */
let vozDestrabada = false;
let contexto: AudioContext | null = null;

/**
 * El contexto de audio de la página, el mismo que se habilita con cada toque.
 * El medidor de volumen lo usa para que también le llegue esa habilitación:
 * un contexto creado fuera de un toque puede quedar suspendido en iPhone, y
 * un medidor suspendido no oye nada.
 */
export function contextoDeAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Clase = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Clase) return null;
    contexto ??= new Clase();
    return contexto;
  } catch {
    return null;
  }
}

export function desbloquearAudio(): void {
  if (typeof window === "undefined") return;
  try {
    if ("speechSynthesis" in window) {
      const s = window.speechSynthesis;
      // Si quedó en pausa (por ejemplo al volver de otra app), se reanuda.
      s.resume();
      if (!vozDestrabada) {
        const muda = new SpeechSynthesisUtterance(" ");
        muda.volume = 0;
        s.speak(muda);
        vozDestrabada = true;
      }
    }
  } catch {
    // Sin voz del navegador: no hay nada que destrabar.
  }
  try {
    const audio = contextoDeAudio();
    if (!audio) return;
    // «suspended» o, en iPhone, «interrupted» (otra cosa tomó el audio): se reanuda.
    if (audio.state !== "running") void audio.resume().catch(() => null);
    // Un instante de silencio: con esto iOS da por habilitado el audio de la página.
    const buffer = audio.createBuffer(1, 1, 22050);
    const fuente = audio.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(audio.destination);
    fuente.start(0);
  } catch {
    // Sin Web Audio: sigue la voz del navegador.
  }
}
