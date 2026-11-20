import { describe, expect, it } from "vitest";
import { DetectorDeVoz, type Sensibilidad } from "@/lib/voz/deteccion";

const PASO = 40; // una medición cada 40 ms, como en la llamada

/** Mide una secuencia de volúmenes mientras habla el Agente. Devuelve a los cuántos ms interrumpió (o null). */
function hablar(d: DetectorDeVoz, niveles: (number | null)[], desde: number): number | null {
  for (let i = 0; i < niveles.length; i++) {
    if (d.medir(niveles[i], desde + i * PASO, true)) return i * PASO;
  }
  return null;
}
/** El Agente dejó de hablar (o la persona lo cortó): se cierra el tramo. */
const callar = (d: DetectorDeVoz, t: number) => d.medir(0, t, false);

const repetir = (n: number, patron: number[]) => Array.from({ length: n }, (_, i) => patron[i % patron.length]);
/** Silencio de ambiente, con el eco ya cancelado (un teléfono). */
const silencio = (ms: number) => repetir(ms / PASO, [0.003, 0.004, 0.002]);
/** Voz de una persona: fuerte, con caídas entre sílabas. */
const voz = (ms: number, fuerza = 0.09) => repetir(ms / PASO, [fuerza, fuerza * 1.2, fuerza * 0.12, fuerza * 1.1, fuerza * 0.9, fuerza * 0.15, fuerza]);
/** La voz del Agente entrando por el micrófono, sin cancelar (una notebook con parlantes). */
const eco = (ms: number, fuerza = 0.1) => repetir(ms / PASO, [fuerza, fuerza * 0.5, fuerza * 1.2, fuerza * 0.3, fuerza * 0.9, fuerza * 0.6, fuerza * 1.1, fuerza * 0.2]);

describe("detectar que la persona habla encima del Agente", () => {
  it("con el eco cancelado, interrumpe a los pocos instantes de empezar a hablar", () => {
    const d = new DetectorDeVoz();
    expect(hablar(d, silencio(2000), 0)).toBeNull();
    const demora = hablar(d, voz(800), 2000);
    expect(demora).not.toBeNull();
    expect(demora as number).toBeLessThanOrEqual(240);
    expect(d.ecoFuerte).toBe(false);
  });

  it("tolera las caídas entre sílabas: no hace falta hablar parejo", () => {
    const d = new DetectorDeVoz();
    hablar(d, silencio(1200), 0);
    // Una de cada tres mediciones cae casi a cero.
    expect(hablar(d, repetir(12, [0.08, 0.07, 0.004]), 1200)).not.toBeNull();
  });

  it("un golpe o una tos corta no interrumpe", () => {
    const d = new DetectorDeVoz();
    hablar(d, silencio(1200), 0);
    expect(hablar(d, [0.4, 0.5, ...silencio(800)], 1200)).toBeNull();
    // Tampoco dos golpes separados.
    expect(hablar(d, [0.4, 0.4, ...silencio(400), 0.4, 0.4, ...silencio(400)], 2200)).toBeNull();
  });

  it("si el micrófono oye al Agente (sin cancelación de eco), no se corta solo", () => {
    const d = new DetectorDeVoz();
    expect(hablar(d, eco(6000), 0)).toBeNull();
    callar(d, 6040);
    expect(hablar(d, eco(6000), 8000)).toBeNull();
    // Lo sabe, para poder avisarlo en pantalla.
    expect(d.ecoFuerte).toBe(true);
    // Para interrumpirlo hay que hablar claramente más fuerte que lo que sale del parlante.
    expect(hablar(d, voz(800, 0.1), 14000)).toBeNull();
    expect(hablar(d, voz(800, 0.5), 14800)).not.toBeNull();
  });

  it("si suben el volumen del parlante, a lo sumo se corta solo dos veces y después se adapta", () => {
    const d = new DetectorDeVoz();
    hablar(d, eco(3000, 0.006), 0); // eco bajito
    callar(d, 3040);
    const cortes = [1, 2, 3, 4].map((i) => {
      const cortado = hablar(d, eco(3000, 0.12), i * 10_000) !== null;
      callar(d, i * 10_000 + 3040);
      return cortado;
    });
    expect(cortes.slice(2)).toEqual([false, false]);
    expect(cortes.filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it("se puede interrumpir apenas el Agente arranca, si ya había hablado antes", () => {
    const d = new DetectorDeVoz();
    hablar(d, silencio(2000), 0);
    callar(d, 2040);
    const demora = hablar(d, voz(600), 5000); // habla desde la primera sílaba del Agente
    expect(demora).not.toBeNull();
    expect(demora as number).toBeLessThanOrEqual(240);
  });

  it("después de una interrupción temprana, la siguiente también anda", () => {
    const d = new DetectorDeVoz();
    hablar(d, silencio(2000), 0);
    callar(d, 2040);
    expect(hablar(d, voz(600), 5000)).not.toBeNull(); // corta apenas arranca
    callar(d, 5700);
    expect(hablar(d, silencio(1500), 8000)).toBeNull();
    expect(hablar(d, voz(600), 9500)).not.toBeNull();
  });

  it("la primera vez que habla el Agente espera un momento antes de decidir", () => {
    const d = new DetectorDeVoz();
    // Todavía no sabe cuánto eco hay: en el primer medio segundo no corta aunque haya ruido.
    expect(hablar(d, eco(560, 0.3), 0)).toBeNull();
  });

  it("apagada, sin poder medir o con el Agente callado, nunca interrumpe", () => {
    const apagada = new DetectorDeVoz("apagada");
    hablar(apagada, silencio(1000), 0);
    expect(hablar(apagada, voz(1000, 0.5), 1000)).toBeNull();

    const ciego = new DetectorDeVoz();
    expect(hablar(ciego, repetir(50, [null as unknown as number]), 0)).toBeNull();

    const callado = new DetectorDeVoz();
    for (let i = 0; i < 50; i++) expect(callado.medir(0.5, i * PASO, false)).toBe(false);
  });

  it("la sensibilidad cambia cuánto hay que levantar la voz", () => {
    const probar = (s: Sensibilidad, fuerza: number) => {
      const d = new DetectorDeVoz(s);
      hablar(d, silencio(1500), 0);
      return hablar(d, repetir(20, [fuerza]), 1500) !== null;
    };
    expect([probar("alta", 0.015), probar("normal", 0.015), probar("baja", 0.015)]).toEqual([true, false, false]);
    expect([probar("alta", 0.03), probar("normal", 0.03), probar("baja", 0.03)]).toEqual([true, true, false]);
    expect(probar("baja", 0.06)).toBe(true);
    // Se puede cambiar en el momento.
    const d = new DetectorDeVoz("baja");
    hablar(d, silencio(1500), 0);
    d.cambiarSensibilidad("alta");
    expect(hablar(d, repetir(20, [0.02]), 1500)).not.toBeNull();
  });
});
