import type { SupabaseClient } from "@supabase/supabase-js";
import { partesEnZona } from "@/lib/programacion/horarios";
import { usoDeSesion } from "./claude/config";
import { armarEstable, armarFoto, armarResumen } from "./contexto";
import { leerInstantanea, type Instantanea, type Sesion } from "./datos";
import {
  definiciones,
  ejecutarHerramienta,
  validarLlamada,
  type Cambio,
  type Contexto,
} from "./herramientas";
import {
  ErrorProveedor,
  type ClaseError,
  type LlamadaHerramienta,
  type MensajeLLM,
  type PedidoLLM,
  type ProveedorLLM,
  usoDe,
} from "./tipos";

/**
 * Un turno del Agente: arma el contexto, llama al modelo, aplica las
 * herramientas que pida y guarda todo. Si un proveedor falla (límite, no
 * responde, o pide herramientas con argumentos inválidos dos veces), sigue
 * con el siguiente usando el mismo historial, sin cortar la conversación.
 */

export type EventoTurno =
  | { tipo: "texto"; texto: string }
  /** Hay que descartar el texto parcial: lo va a responder otro proveedor. */
  | { tipo: "reiniciar" }
  | { tipo: "cambio"; cambio: Cambio }
  | { tipo: "proveedor"; id: string; modelo: string }
  | { tipo: "cambio_proveedor"; de: string; motivo: ClaseError }
  | { tipo: "error"; mensaje: string }
  /** Algo que la persona tiene que saber, sin ser un error (presupuesto de Claude). */
  | { tipo: "aviso"; mensaje: string }
  | { tipo: "fin"; texto: string; proveedor: string | null };

/** Pasado este tiempo, la foto de memorias y estado de una sesión se vuelve a armar. */
const VIGENCIA_FOTO_MS = 60 * 60_000;
/** Tope de idas y vueltas con el modelo en un turno (cada una gasta cupo). */
const MAX_PASOS = 6;
const MAX_MENSAJES_HISTORIAL = 40;
/** Tras un 429 no se vuelve a probar ese proveedor por un rato. */
const PAUSA_POR_LIMITE_MS = 2 * 60_000;
const enPausa = new Map<string, number>();

type FilaMensaje = {
  role: "usuario" | "agente" | "herramienta" | "sistema";
  content: string | null;
  tool_calls: LlamadaHerramienta[] | null;
  tool_result: { id: string; nombre: string; resultado: unknown } | null;
  created_at: string;
};

/**
 * Máximo de cada mensaje del historial al armar el pedido. Los mensajes se
 * pueden escribir desde el navegador (con la sesión de la persona), así que
 * no se confía en su largo: un pedido no puede crecer sin control.
 */
export const MAX_CARACTERES_MENSAJE = 6000;
const MAX_CARACTERES_RESULTADO = 8000;
const MAX_CARACTERES_ARGUMENTOS = 4000;

const recortar = (texto: string, max = MAX_CARACTERES_MENSAJE) =>
  texto.length > max ? `${texto.slice(0, max)}… [recortado]` : texto;

function acotarResultado(resultado: unknown): unknown {
  const crudo = JSON.stringify(resultado ?? null) ?? "null";
  return crudo.length > MAX_CARACTERES_RESULTADO ? { recortado: true, texto: crudo.slice(0, MAX_CARACTERES_RESULTADO) } : resultado;
}

function acotarLlamadas(llamadas: unknown): LlamadaHerramienta[] {
  if (!Array.isArray(llamadas)) return [];
  return llamadas.slice(0, 10).map((l: LlamadaHerramienta) => ({
    ...l,
    id: String(l?.id ?? "").slice(0, 100),
    nombre: String(l?.nombre ?? "").slice(0, 100),
    argumentos: (JSON.stringify(l?.argumentos ?? {}) ?? "").length > MAX_CARACTERES_ARGUMENTOS ? {} : l.argumentos,
  }));
}

export function aMensajes(filas: FilaMensaje[]): MensajeLLM[] {
  const salida: MensajeLLM[] = [];
  for (const f of filas) {
    if (f.role === "usuario" || f.role === "sistema") salida.push({ rol: "usuario", texto: recortar(f.content ?? "") });
    else if (f.role === "agente") {
      const llamadas = acotarLlamadas(f.tool_calls);
      salida.push({ rol: "agente", texto: recortar(f.content ?? ""), ...(llamadas.length ? { llamadas } : {}) });
    } else if (f.tool_result) {
      salida.push({
        rol: "herramienta",
        id: String(f.tool_result.id ?? "").slice(0, 100),
        nombre: String(f.tool_result.nombre ?? "").slice(0, 100),
        resultado: acotarResultado(f.tool_result.resultado),
      });
    }
  }
  // El historial tiene que empezar en un turno del usuario: un resultado de
  // herramienta suelto (por un recorte) hace fallar a los proveedores.
  while (salida.length && salida[0].rol !== "usuario") salida.shift();
  return salida;
}

export async function* correrTurno(p: {
  sb: SupabaseClient;
  /**
   * Cliente con la clave de servicio, para las columnas de la sesión que la
   * persona no puede escribir (proveedores usados, foto del contexto). Sin él
   * no se guardan: la foto se arma igual en cada turno.
   */
  admin?: SupabaseClient | null;
  sesion: Sesion;
  proveedores: ProveedorLLM[];
  entrada: { texto?: string; inicio?: boolean };
  voz?: boolean;
  ahora?: Date;
  datos?: Instantanea;
  senal?: AbortSignal;
  /**
   * Se dice una sola vez al llegar al tope de gasto de Claude. Va como parte de
   * la respuesta (también se escucha en voz), antes de lo que conteste el modelo.
   */
  avisoTope?: string;
}): AsyncGenerator<EventoTurno> {
  const { sb, sesion } = p;
  const ahora = p.ahora ?? new Date();
  const datos = p.datos ?? (await leerInstantanea(sb, sesion.id));
  const ctx: Contexto = {
    sb,
    sesionId: sesion.id,
    hoy: partesEnZona(ahora, datos.perfil.timezone).fecha,
    datos,
    cambios: [],
  };

  let consulta = sb
    .from("messages")
    .select("role,content,tool_calls,tool_result,created_at")
    .eq("session_id", sesion.id)
    .order("created_at", { ascending: false })
    .limit(MAX_MENSAJES_HISTORIAL);
  if (sesion.history_summary_until) consulta = consulta.gt("created_at", sesion.history_summary_until);
  const previos = (((await consulta).data ?? []) as FilaMensaje[]).reverse();
  const historial = aMensajes(previos);

  // created_at explícito y siempre creciente: varios mensajes del mismo
  // milisegundo tienen que conservar el orden.
  let reloj = Math.max(Date.now(), previos.length ? new Date(previos[previos.length - 1].created_at).getTime() + 1 : 0);
  const guardar = async (fila: Record<string, unknown>): Promise<string | null> => {
    const { data } = await sb
      .from("messages")
      .insert({ session_id: sesion.id, ...fila, created_at: new Date(reloj++).toISOString() })
      .select("id")
      .single();
    return (data as { id: string } | null)?.id ?? null;
  };

  if (p.entrada.texto) {
    await guardar({ role: "usuario", content: p.entrada.texto });
    historial.push({ rol: "usuario", texto: p.entrada.texto });
  } else if (p.entrada.inicio) {
    const apertura = "(Empieza la sesión. Abrí vos la conversación.)";
    await guardar({ role: "sistema", content: apertura });
    historial.push({ rol: "usuario", texto: apertura });
  }
  if (!sesion.started_at || sesion.status !== "en_curso") {
    const inicio = { status: "en_curso", started_at: sesion.started_at ?? ahora.toISOString() };
    await sb.from("sessions").update(inicio).eq("id", sesion.id);
    Object.assign(sesion, inicio);
  }

  if (!p.proveedores.length) {
    yield {
      tipo: "error",
      mensaje: "El Agente todavía no tiene un modelo configurado (falta la clave de Gemini o de Groq). El panel funciona igual.",
    };
    yield { tipo: "fin", texto: "", proveedor: null };
    return;
  }

  // Lo que el Agente sabe se congela al empezar la sesión: así el principio del
  // pedido es idéntico en cada turno y Claude lo lee del caché. Se rehace si la
  // sesión lleva más de una hora (un chat retomado más tarde).
  const vencida =
    !sesion.context_snapshot_at || ahora.getTime() - new Date(sesion.context_snapshot_at).getTime() > VIGENCIA_FOTO_MS;
  if (!sesion.context_snapshot || vencida) {
    const foto = { context_snapshot: armarFoto({ datos, sesion, ahora }), context_snapshot_at: ahora.toISOString() };
    if (p.admin) await p.admin.from("sessions").update(foto).eq("id", sesion.id).eq("user_id", datos.perfil.user_id);
    Object.assign(sesion, foto);
  }
  const voz = Boolean(p.voz);
  const uso = usoDeSesion(sesion.kind);
  let textoAviso = "";
  if (p.avisoTope) {
    // Se guarda como mensaje del Agente para que quede en la transcripción,
    // pero no entra en el pedido de este turno (no puede ser lo último).
    await guardar({ role: "agente", content: p.avisoTope });
    textoAviso = p.avisoTope + "\n\n";
    yield { tipo: "texto", texto: textoAviso };
  }
  const sistemaPartes = [armarEstable(sesion, voz), [sesion.context_snapshot, armarResumen(sesion)].filter(Boolean).join("\n\n")];
  const sistema = sistemaPartes.join("\n\n");
  const herramientas = definiciones();
  const libres = p.proveedores.filter((x) => (enPausa.get(x.id) ?? 0) < Date.now());
  // Si todos están en pausa se prueba igual: peor es no intentar.
  const cola = libres.length ? [...libres] : [...p.proveedores];
  const invalidas = new Map<string, number>();
  /** Intentos fallidos que se le muestran al modelo para que corrija; no van a la transcripción. */
  const efimeros = new Set<MensajeLLM>();
  const usados = new Set<string>();
  let textoFinal = "";
  let ultimo: string | null = null;
  let anunciado: string | null = null;
  let termino = false;

  for (let paso = 0; paso < MAX_PASOS + p.proveedores.length && !termino; paso++) {
    const prov = cola[0];
    if (!prov) {
      yield {
        tipo: "error",
        mensaje: "Ahora no puedo responder: los modelos gratuitos llegaron a su límite o no contestan. Probá de nuevo en unos minutos; el panel sigue funcionando.",
      };
      break;
    }
    if (anunciado !== prov.id) {
      anunciado = prov.id;
      yield { tipo: "proveedor", id: prov.id, modelo: prov.modelo(uso) };
    }

    let texto = "";
    const llamadas: LlamadaHerramienta[] = [];
    let tokens = { entrada: 0, salida: 0 };
    try {
      for await (const t of prov.generar({ sistema, sistemaPartes, mensajes: historial, herramientas, senal: p.senal, uso, voz })) {
        if (t.tipo === "texto") {
          texto += t.texto;
          yield { tipo: "texto", texto: t.texto };
        } else if (t.tipo === "llamada") llamadas.push(t.llamada);
        else if (t.tipo === "aviso") yield { tipo: "aviso", mensaje: t.mensaje };
        else tokens = { entrada: t.entrada, salida: t.salida };
      }
    } catch (error) {
      if (p.senal?.aborted) throw error;
      const clase: ClaseError = error instanceof ErrorProveedor ? error.clase : "otro";
      // Queda en los registros del servidor para poder diagnosticar (modelo mal
      // escrito, cupo, clave inválida). El mensaje del proveedor no trae claves.
      console.warn(`[agente] ${prov.id} (${prov.modelo(uso)}) falló: ${clase}. ${error instanceof Error ? error.message : ""}`);
      if (clase === "limite") enPausa.set(prov.id, Date.now() + PAUSA_POR_LIMITE_MS);
      cola.shift();
      if (texto) yield { tipo: "reiniciar" };
      yield { tipo: "cambio_proveedor", de: prov.id, motivo: clase };
      continue;
    }

    const datosModelo = { provider: prov.id, model: prov.modelo(uso), tokens_in: tokens.entrada, tokens_out: tokens.salida };

    if (!llamadas.length) {
      await guardar({ role: "agente", content: texto, ...datosModelo });
      usados.add(prov.id);
      ultimo = prov.id;
      textoFinal += texto;
      termino = true;
      break;
    }

    // Se valida todo antes de aplicar nada: si una llamada viene mal no se
    // ejecuta ninguna, así el reintento no duplica cambios.
    const problemas = llamadas.map((l) => validarLlamada(l.nombre, l.argumentos));
    if (problemas.some(Boolean)) {
      const veces = (invalidas.get(prov.id) ?? 0) + 1;
      invalidas.set(prov.id, veces);
      if (texto) yield { tipo: "reiniciar" };
      if (veces >= 2) {
        // Segunda vez: se descarta la respuesta y sigue otro proveedor, con el
        // historial limpio (sin los intentos fallidos de este).
        cola.shift();
        for (let i = historial.length - 1; i >= 0; i--) if (efimeros.has(historial[i])) historial.splice(i, 1);
        yield { tipo: "cambio_proveedor", de: prov.id, motivo: "invalido" };
        continue;
      }
      // Primera vez: se le muestra el error para que corrija. No se guarda en la transcripción.
      const intento: MensajeLLM[] = [
        { rol: "agente", texto, llamadas },
        ...llamadas.map((l, i): MensajeLLM => ({
          rol: "herramienta",
          id: l.id,
          nombre: l.nombre,
          resultado: { error: problemas[i] ?? "No se ejecutó porque otra llamada del mismo mensaje era inválida. Repetila." },
        })),
      ];
      for (const m of intento) {
        efimeros.add(m);
        historial.push(m);
      }
      continue;
    }

    usados.add(prov.id);
    ultimo = prov.id;
    // Lo que vale solo dentro del turno (el razonamiento de Claude) no se guarda.
    const paraGuardar = llamadas.map(({ extraTurno: _turno, ...l }) => (void _turno, l));
    ctx.mensajeId = await guardar({ role: "agente", content: texto || null, tool_calls: paraGuardar, ...datosModelo });
    historial.push({ rol: "agente", texto, llamadas });
    if (texto) {
      textoFinal += texto + "\n\n";
      yield { tipo: "texto", texto: "\n\n" };
    }
    for (const l of llamadas) {
      const desde = ctx.cambios.length;
      const r = await ejecutarHerramienta(ctx, l.nombre, l.argumentos);
      await guardar({ role: "herramienta", tool_result: { id: l.id, nombre: l.nombre, resultado: r.resultado } });
      historial.push({ rol: "herramienta", id: l.id, nombre: l.nombre, resultado: r.resultado });
      for (const cambio of ctx.cambios.slice(desde)) yield { tipo: "cambio", cambio };
    }
  }

  if (!termino && ultimo && ctx.cambios.length) {
    // Se acabaron los pasos después de aplicar cambios: al menos se avisa.
    const cierre = "Listo, ya apliqué los cambios.";
    await guardar({ role: "agente", content: cierre, provider: ultimo });
    textoFinal += cierre;
    yield { tipo: "texto", texto: cierre };
  }

  if (usados.size) {
    const todos = [...new Set([...(sesion.providers_used ?? []), ...usados])];
    if (p.admin) await p.admin.from("sessions").update({ providers_used: todos }).eq("id", sesion.id).eq("user_id", datos.perfil.user_id);
    sesion.providers_used = todos;
  }
  yield { tipo: "fin", texto: (textoAviso + textoFinal).trim(), proveedor: ultimo };
}

/** Un pedido simple de texto (sin herramientas), probando cada proveedor en orden. */
export async function completar(proveedores: ProveedorLLM[], pedido: PedidoLLM): Promise<string | null> {
  for (const prov of proveedores) {
    try {
      let texto = "";
      for await (const t of prov.generar(pedido)) if (t.tipo === "texto") texto += t.texto;
      if (texto.trim()) return texto;
    } catch (error) {
      // Se prueba el siguiente.
      console.warn(`[agente] ${prov.id} (${prov.modelo(usoDe(pedido))}) falló en segundo plano. ${error instanceof Error ? error.message : ""}`);
    }
  }
  return null;
}

const RESUMIR_DESDE = 24;
const DEJAR_SIN_RESUMIR = 8;

/**
 * Cuando la sesión crece, lo viejo se resume con el modelo liviano y deja de
 * enviarse en cada turno. Si el resumen falla no pasa nada: el historial ya
 * está acotado a los últimos mensajes.
 */
export async function resumirSiHaceFalta(
  sb: SupabaseClient,
  sesion: Sesion,
  proveedores: ProveedorLLM[],
  admin: SupabaseClient | null,
) {
  // El resumen lo escribe solo el servidor: sin la clave de servicio no se hace.
  if (!admin) return;
  let consulta = sb
    .from("messages")
    .select("role,content,created_at")
    .eq("session_id", sesion.id)
    .in("role", ["usuario", "agente"])
    .order("created_at")
    .limit(200);
  if (sesion.history_summary_until) consulta = consulta.gt("created_at", sesion.history_summary_until);
  const filas = ((await consulta).data ?? []) as { role: string; content: string | null; created_at: string }[];
  if (filas.length < RESUMIR_DESDE) return;

  const viejos = filas.slice(0, filas.length - DEJAR_SIN_RESUMIR);
  const texto = viejos
    .filter((f) => f.content)
    .map((f) => `${f.role === "usuario" ? "Usuario" : "Agente"}: ${f.content}`)
    .join("\n")
    .slice(-12_000);
  const resumen = await completar(proveedores, {
    liviano: true,
    sistema:
      "Resumí esta conversación entre una persona y su asistente en un máximo de 150 palabras, en español. Conservá: temas tratados, decisiones, compromisos con fecha y lo que quedó pendiente. Solo el resumen, sin introducción.",
    mensajes: [
      { rol: "usuario", texto: (sesion.history_summary ? `Resumen anterior:\n${sesion.history_summary}\n\n` : "") + texto },
    ],
  });
  if (!resumen) return;
  const cambios = {
    history_summary: resumen.trim().slice(0, 2000),
    history_summary_until: viejos[viejos.length - 1].created_at,
  };
  await admin.from("sessions").update(cambios).eq("id", sesion.id);
}
