import { describe, expect, it } from "vitest";
import type { EventoCliente } from "@/lib/agente/cliente";
import { CUPOS_F0, cuposDe, evaluarCupo } from "@/lib/voz/cupo";
import { ControlLlamada, type EstadoLlamada } from "@/lib/voz/llamada";
import { paraVoz, Segmentador } from "@/lib/voz/oraciones";
import type { AlTexto, ProveedorVoz } from "@/lib/voz/tipos";

describe("cupo de voz", () => {
  it("avisa al 90 % y corta antes de pasarse, con el que esté más lleno", () => {
    expect(evaluarCupo(null, CUPOS_F0)).toMatchObject({ porcentaje: 0, aviso: false, agotado: false });
    expect(evaluarCupo({ stt_seconds: 0.89 * 18000, tts_chars: 0 }, CUPOS_F0)).toMatchObject({ aviso: false, agotado: false });
    expect(evaluarCupo({ stt_seconds: 0.9 * 18000, tts_chars: 0 }, CUPOS_F0)).toMatchObject({ porcentaje: 90, aviso: true, agotado: false });
    // La voz (caracteres) también puede ser la que se agota.
    expect(evaluarCupo({ stt_seconds: 100, tts_chars: 495_000 }, CUPOS_F0)).toMatchObject({ aviso: true, agotado: true, tts: 99 });
    expect(evaluarCupo({ stt_seconds: 20_000, tts_chars: 0 }, CUPOS_F0)).toMatchObject({ porcentaje: 100, agotado: true });
  });

  it("los cupos se pueden ajustar por variables de entorno", () => {
    expect(cuposDe({})).toEqual(CUPOS_F0);
    expect(cuposDe({ AZURE_CUPO_STT_SEGUNDOS: "3600", AZURE_CUPO_TTS_CARACTERES: "nada" })).toEqual({
      sttSegundos: 3600, ttsCaracteres: 500_000,
    });
  });
});

describe("corte en oraciones", () => {
  it("la primera oración sale sola y el resto en bloques", () => {
    const s = new Segmentador();
    expect(s.agregar("Hola. ¿Qué pasó con ")).toEqual([]); // "Hola." sola es demasiado corta
    expect(s.agregar("los azulejos? ")).toEqual(["Hola. ¿Qué pasó con los azulejos?"]);
    // Después junta hasta tener un bloque razonable (menos pedidos de síntesis).
    expect(s.agregar("La semana pasada quedaste en elegirlos. ")).toEqual([]);
    const largo = "Si seguís sin decidir, te propongo ir el sábado a la barraca con las medidas y cerrar el tema ahí mismo, sin vueltas. ";
    expect(s.agregar(largo)).toEqual(["La semana pasada quedaste en elegirlos. " + largo.trim()]);
    expect(s.agregar("¿Te sirve?")).toEqual([]);
    expect(s.cerrar()).toEqual(["¿Te sirve?"]);
  });

  it("no corta en números ni abreviaturas, y limpia lo que no se lee", () => {
    const s = new Segmentador();
    expect(s.agregar("Tenés 2. ")).toEqual([]);
    expect(s.agregar("5 tareas vencidas del Dr. Pérez. ")).toEqual(["Tenés 2. 5 tareas vencidas del Dr. Pérez."]);
    expect(paraVoz("**Listo**: te dejo `esto` para el [jueves](http://x).\n- Uno\n- Dos")).toBe(
      "Listo: te dejo esto para el jueves. Uno Dos",
    );
  });
});

/** Proveedor de voz de mentira: anota lo que "dice" y deja simular lo que la persona habla. */
function vozFalsa() {
  let alTexto: AlTexto | null = null;
  let soltar: (() => void) | null = null;
  const v = {
    id: "prueba" as const,
    dicho: [] as string[],
    escuchando: false,
    callado: 0,
    /** Simula que la persona dijo algo. */
    decir(texto: string, final = true) {
      alTexto?.(texto, final);
    },
    /** Termina la frase que está sonando. */
    terminarFrase() {
      soltar?.();
    },
    async escuchar(al: AlTexto) {
      alTexto = al;
      v.escuchando = true;
    },
    async pausar() {
      v.escuchando = false;
    },
    hablar(texto: string) {
      v.dicho.push(texto);
      return new Promise<void>((listo) => {
        soltar = () => {
          soltar = null;
          listo();
        };
      });
    },
    callar() {
      v.callado++;
      soltar?.();
    },
    cerrar() {
      v.escuchando = false;
      soltar?.();
    },
    segundosNuevos: () => 7,
  };
  return v satisfies ProveedorVoz & Record<string, unknown>;
}

const tic = () => new Promise((r) => setTimeout(r, 0));

describe("control de la llamada", () => {
  function armar(respuestas: EventoCliente[][]) {
    const voz = vozFalsa();
    const pedidos: { texto?: string; inicio?: boolean }[] = [];
    const senales: AbortSignal[] = [];
    let estado!: EstadoLlamada;
    let nivel = 0;
    const control = new ControlLlamada({
      voz,
      nivel: () => nivel,
      alCambiar: (e) => (estado = e),
      async *turno(pedido, senal) {
        pedidos.push(pedido);
        senales.push(senal);
        for (const e of respuestas.shift() ?? []) {
          await tic();
          if (senal.aborted) return;
          yield e;
        }
      },
    });
    return { voz, control, pedidos, senales, estado: () => estado, ponerNivel: (n: number) => (nivel = n) };
  }
  const texto = (t: string): EventoCliente => ({ tipo: "texto", texto: t });

  it("el Agente abre, habla por oraciones y después escucha; una frase final dispara el turno", async () => {
    const { voz, control, pedidos, estado } = armar([
      [texto("Hola. La vez pasada quedaste en "), texto("elegir los azulejos. ¿Qué pasó?")],
      [texto("Bien ahí.")],
    ]);
    const fin = control.empezar(true);
    await tic(); await tic(); await tic(); await tic();
    expect(pedidos).toEqual([{ inicio: true }]);
    expect(estado().fase).toBe("hablando");
    expect(voz.escuchando).toBe(false); // mientras habla no se manda audio
    expect(voz.dicho).toEqual(["Hola. La vez pasada quedaste en elegir los azulejos."]);
    voz.terminarFrase();
    await tic();
    expect(voz.dicho[1]).toBe("¿Qué pasó?");
    voz.terminarFrase();
    await fin;
    expect(estado().fase).toBe("escuchando");
    expect(voz.escuchando).toBe(true);

    voz.decir("Los eleg", false);
    expect(estado().parcial).toBe("Los eleg");
    voz.decir("Los elegí ayer.");
    await tic(); await tic(); await tic();
    expect(pedidos[1]).toEqual({ texto: "Los elegí ayer." });
    expect(estado().lineas.map((l) => [l.quien, l.texto])).toEqual([
      ["agente", "Hola. La vez pasada quedaste en elegir los azulejos. ¿Qué pasó?"],
      ["vos", "Los elegí ayer."],
      ["agente", "Bien ahí."],
    ]);
  });

  it("si la persona habla encima, el Agente corta, descarta lo que le faltaba decir y escucha", async () => {
    const { voz, control, senales, estado, ponerNivel } = armar([
      [texto("Primera oración bastante larga. "), texto("Segunda oración que no se va a llegar a decir nunca, porque lo interrumpen antes de que empiece a sonar por el parlante. "), texto("Tercera.")],
    ]);
    void control.empezar(true);
    await tic(); await tic(); await tic();
    expect(estado().fase).toBe("hablando");

    // Un ruido corto no alcanza: tiene que sostenerse.
    ponerNivel(0.3);
    control.revisarVolumen(1000);
    control.revisarVolumen(1200);
    expect(estado().fase).toBe("hablando");
    ponerNivel(0.01);
    control.revisarVolumen(1250);
    ponerNivel(0.3);
    control.revisarVolumen(1300);
    control.revisarVolumen(1600);
    expect(estado().fase).toBe("hablando");
    control.revisarVolumen(1660); // 360 ms seguidos por encima del umbral
    await tic();

    expect(voz.callado).toBe(1);
    expect(senales[0].aborted).toBe(true);
    expect(estado().fase).toBe("escuchando");
    expect(voz.escuchando).toBe(true);
    await tic(); await tic(); await tic();
    expect(voz.dicho).toEqual(["Primera oración bastante larga."]); // nada más salió por el parlante
  });

  it("silenciado no escucha ni manda nada; al volver, sigue", async () => {
    const { voz, control, pedidos, estado } = armar([]);
    await control.empezar(false);
    control.silenciar(true);
    expect(voz.escuchando).toBe(false);
    voz.decir("esto no se tiene que enviar");
    expect(pedidos).toEqual([]);
    control.silenciar(false);
    await tic();
    expect(voz.escuchando).toBe(true);
    expect(estado().silenciado).toBe(false);
  });

  it("los cambios y los errores del turno llegan a la pantalla; cerrar corta todo", async () => {
    const { voz, control, senales, estado } = armar([
      [
        texto("Te dejo esto para el jueves. "),
        { tipo: "cambio", cambio: { id: "c1", table_name: "tasks", row_id: "t1", operation: "actualizar", summary: "«Azulejos»: fecha límite → jue 12" } },
        { tipo: "error", mensaje: "Ahora no puedo responder" },
      ],
    ]);
    void control.empezar(true);
    await tic(); await tic(); await tic(); await tic(); await tic();
    expect(estado().lineas[0].cambios.map((c) => c.summary)).toEqual(["«Azulejos»: fecha límite → jue 12"]);
    expect(estado().aviso).toBe("Ahora no puedo responder");
    control.cerrar();
    expect(estado().fase).toBe("cerrada");
    expect(senales[0].aborted).toBe(true);
    expect(control.segundosNuevos()).toBe(7);
    voz.decir("ya corté");
    expect(estado().lineas).toHaveLength(1);
  });

  it("se puede cambiar de proveedor de voz a mitad de la llamada", async () => {
    const { voz, control, estado } = armar([]);
    await control.empezar(false);
    const otra = vozFalsa();
    control.cambiarVoz({ ...otra, id: "navegador" }, "Se agotó el cupo de Azure");
    await tic();
    expect(voz.escuchando).toBe(false);
    expect(estado()).toMatchObject({ motor: "navegador", aviso: "Se agotó el cupo de Azure", fase: "escuchando" });
  });
});
