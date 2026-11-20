import "server-only";
import { armarEstable, armarFoto, armarResumen } from "@/lib/agente/contexto";
import type { Instantanea, Sesion } from "@/lib/agente/datos";
import type { DefHerramienta } from "@/lib/agente/tipos";
import type { Sensibilidad } from "../deteccion";
import { RUTA_SOCKET } from "./protocolo";
import { VOCES_VIVO, VOZ_VIVO_POR_DEFECTO } from "./tipos";

/**
 * Lado del servidor de la llamada en vivo (Gemini Live API). La clave de
 * Gemini nunca llega al navegador: acá se pide un token de un solo uso y de
 * pocos minutos, que además lleva fijados el modelo, las instrucciones y las
 * herramientas. Con ese token el navegador abre el WebSocket directo con el
 * servicio (Vercel no puede sostener un WebSocket) y no puede cambiar nada de
 * lo fijado.
 */

/** El nombre cambia seguido: se ajusta con GEMINI_MODEL_VIVO. */
export const MODELO_VIVO_POR_DEFECTO = "gemini-3.8-live";

export type ConfigVivo = { clave: string; base: string; modelo: string };

/** La llamada en vivo usa la clave de Gemini: sin ella no hay (y las llamadas van por turnos). */
export function configVivo(env: Record<string, string | undefined> = process.env): ConfigVivo | null {
  const clave = (env.GEMINI_API_KEY ?? "").trim();
  if (!clave) return null;
  return {
    clave,
    // La misma variable que usa el chat; en las pruebas apunta a un servicio de mentira.
    base: ((env.GEMINI_BASE_URL ?? "").trim() || "https://generativelanguage.googleapis.com").replace(/\/$/, ""),
    modelo: (env.GEMINI_MODEL_VIVO ?? "").trim() || MODELO_VIVO_POR_DEFECTO,
  };
}

export const vozVivoDe = (agentConfig: Record<string, unknown> | undefined): string => {
  const elegida = agentConfig?.voz_vivo;
  return VOCES_VIVO.some((v) => v.id === elegida) ? (elegida as string) : VOZ_VIVO_POR_DEFECTO;
};

const EN_VIVO = `Esta sesión es una LLAMADA EN VIVO: oís la voz de la persona y ella la tuya, como por teléfono. Hablá natural, en español rioplatense, con frases cortas.
- Si te habla encima, dejá lo que estabas diciendo y respondé a lo nuevo, sin retomar la frase cortada.
- Si no entendiste algo, pedí que lo repita; no adivines nombres ni fechas.
- Usá las herramientas sin anunciarlo antes; después decí en una frase lo que cambiaste.
- Lo que te llegue escrito entre paréntesis son indicaciones de la aplicación, no palabras de la persona: seguilas sin leerlas en voz alta.`;

export const APERTURA = "(Empieza la sesión. Abrí vos la conversación.)";

type Previo = { role: string; content: string | null };
const MAX_PREVIOS = 30;
const MAX_POR_MENSAJE = 500;

/** Lo ya hablado en la sesión, para que una conexión nueva siga donde quedó la anterior. */
export function transcripcionPrevia(previos: Previo[]): string {
  const lineas = previos
    .filter((m) => (m.role === "usuario" || m.role === "agente") && m.content?.trim())
    .slice(-MAX_PREVIOS)
    .map((m) => {
      const texto = (m.content ?? "").trim();
      return `${m.role === "usuario" ? "Persona" : "Vos"}: ${texto.length > MAX_POR_MENSAJE ? texto.slice(0, MAX_POR_MENSAJE) + "…" : texto}`;
    });
  if (!lineas.length) return "";
  return (
    "Esta conversación ya venía en curso. Lo último que se habló:\n" +
    lineas.join("\n") +
    "\nSeguí desde ahí: no vuelvas a saludar ni repitas lo ya dicho. Esperá a que la persona hable."
  );
}

/** Las instrucciones completas de una conexión en vivo. La foto del estado se arma en el momento. */
export function sistemaVivo(p: { sesion: Sesion; datos: Instantanea; ahora: Date; previos: Previo[] }): string {
  return [
    armarEstable(p.sesion, true),
    EN_VIVO,
    armarFoto({ datos: p.datos, sesion: p.sesion, ahora: p.ahora }),
    armarResumen(p.sesion),
    transcripcionPrevia(p.previos),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Qué tan fácil se da por empezada una frase de la persona (lo que corta al
 * Agente). Es el mismo ajuste de Configuración → Voz que usa el motor por turnos.
 */
function escucha(sensibilidad: Sensibilidad): Record<string, unknown> {
  if (sensibilidad === "apagada") return { activityHandling: "NO_INTERRUPTION" };
  const inicio = sensibilidad === "alta" ? "START_SENSITIVITY_HIGH" : sensibilidad === "baja" ? "START_SENSITIVITY_LOW" : null;
  return {
    activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    ...(inicio ? { automaticActivityDetection: { startOfSpeechSensitivity: inicio } } : {}),
  };
}

export type FormatoHerramientas = "json" | "clasico" | "ninguna";

/** Los ajustes de la sesión en vivo, en el formato del servicio (BidiGenerateContentSetup). */
export function ajustesVivo(p: {
  modelo: string;
  sistema: string;
  herramientas: DefHerramienta[];
  voz: string;
  sensibilidad: Sensibilidad;
  formato?: FormatoHerramientas;
}): Record<string, unknown> {
  const formato = p.formato ?? "json";
  return {
    model: `models/${p.modelo}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: p.voz } } },
    },
    systemInstruction: { parts: [{ text: p.sistema }] },
    ...(p.herramientas.length && formato !== "ninguna"
      ? {
          tools: [
            {
              functionDeclarations: p.herramientas.map((h) => ({
                name: h.nombre,
                description: h.descripcion,
                ...(formato === "json" ? { parametersJsonSchema: h.parametros } : { parameters: h.parametros }),
              })),
            },
          ],
        }
      : {}),
    // Para mostrar y guardar lo que se dijo de cada lado.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: escucha(p.sensibilidad),
    // Sin esto una sesión de solo audio se corta a los 15 minutos.
    contextWindowCompression: { slidingWindow: {} },
  };
}

export type TokenVivo = { ok: true; url: string } | { ok: false; estado: number; detalle: string };

const VIDA_DEL_TOKEN_MS = 30 * 60_000;
/** Tiempo para usar el token (abrir la conexión) desde que se entrega. */
const PARA_CONECTAR_MS = 2 * 60_000;

/**
 * Pide el token de un solo uso con los ajustes fijados y arma la dirección del
 * WebSocket. El detalle del error es el que da el servicio: no trae la clave.
 */
export async function pedirTokenVivo(config: ConfigVivo, ajustes: unknown, ahora: Date = new Date()): Promise<TokenVivo> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${config.base}/v1alpha/auth_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.clave },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(ahora.getTime() + VIDA_DEL_TOKEN_MS).toISOString(),
        newSessionExpireTime: new Date(ahora.getTime() + PARA_CONECTAR_MS).toISOString(),
        bidiGenerateContentSetup: ajustes,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return { ok: false, estado: 0, detalle: error instanceof Error ? error.message : "Sin conexión" };
  }
  const cuerpo = (await respuesta.json().catch(() => null)) as { name?: string; error?: { message?: string } } | null;
  if (!respuesta.ok || typeof cuerpo?.name !== "string" || !cuerpo.name) {
    return { ok: false, estado: respuesta.status, detalle: (cuerpo?.error?.message ?? "Respuesta sin token").slice(0, 300) };
  }
  return { ok: true, url: `${config.base.replace(/^http/, "ws")}${RUTA_SOCKET}?access_token=${encodeURIComponent(cuerpo.name)}` };
}
