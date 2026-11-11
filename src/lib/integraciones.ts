import "server-only";
import { supabaseConfigurado } from "@/lib/env";

/**
 * Qué integraciones tienen sus variables cargadas. Solo dice sí o no: los
 * valores nunca salen de acá. Cada función de la app consulta esto y, si le
 * falta su clave, muestra «falta configurar» en lugar de romperse.
 */
const tiene = (...nombres: string[]) => nombres.every((n) => (process.env[n] ?? "").trim() !== "");

export type Integracion = {
  id: string;
  nombre: string;
  configurada: boolean | null; // null = no se puede comprobar desde la app
  paraQue: string;
  variables: string[];
  opcional?: boolean;
};

export function integraciones(): Integracion[] {
  return [
    {
      id: "supabase",
      nombre: "Supabase (base de datos e ingreso)",
      configurada: supabaseConfigurado,
      paraQue: "Sin esto la app no arranca.",
      variables: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    },
    {
      id: "servicio",
      nombre: "Supabase, clave de servicio",
      configurada: tiene("SUPABASE_SERVICE_ROLE_KEY"),
      paraQue: "Registro del gasto de Claude, límites de uso por persona, llamadas programadas, contador de voz de Azure y borrado de la cuenta. Sin esto el Agente no responde.",
      variables: ["SUPABASE_SERVICE_ROLE_KEY"],
    },
    {
      id: "claude",
      nombre: "Claude (cerebro principal, pago con tope)",
      configurada: tiene("ANTHROPIC_API_KEY"),
      paraQue: "Chat y llamadas con Claude, con un tope de gasto mensual. Sin esto el Agente usa los modelos gratuitos.",
      variables: ["ANTHROPIC_API_KEY", "CLAUDE_TOPE_USD_GLOBAL"],
      opcional: true,
    },
    {
      id: "claude_permitidos",
      nombre: "Quién puede usar Claude",
      configurada: tiene("CLAUDE_USUARIOS_PERMITIDOS"),
      paraQue:
        "Correos (separados por coma) que pueden usar Claude y ver esta página. Vacía: nadie usa Claude y el Agente sigue con los modelos gratuitos.",
      variables: ["CLAUDE_USUARIOS_PERMITIDOS"],
    },
    {
      id: "gemini",
      nombre: "Gemini (cerebro gratuito)",
      configurada: tiene("GEMINI_API_KEY"),
      paraQue: "Chat y llamadas con el Agente.",
      variables: ["GEMINI_API_KEY", "GEMINI_MODEL_CHAT", "GEMINI_MODEL_FONDO"],
    },
    {
      id: "groq",
      nombre: "Groq (cerebro de respaldo)",
      configurada: tiene("GROQ_API_KEY"),
      paraQue: "Sigue la conversación cuando Gemini llega a su límite.",
      variables: ["GROQ_API_KEY", "GROQ_MODEL"],
    },
    {
      id: "ollama",
      nombre: "Ollama (modelo local)",
      configurada: tiene("OLLAMA_BASE_URL", "OLLAMA_MODEL"),
      paraQue: "Usar un modelo en tu computadora, sin límites.",
      variables: ["OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_AUTH_TOKEN"],
      opcional: true,
    },
    {
      id: "azure",
      nombre: "Azure Speech (voz)",
      configurada: tiene("AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "SUPABASE_SERVICE_ROLE_KEY"),
      paraQue: "Voz de mejor calidad. Sin esto las llamadas usan la voz del navegador.",
      variables: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
      opcional: true,
    },
    {
      id: "push",
      nombre: "Notificaciones push",
      configurada: tiene("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"),
      paraQue: "El aviso en el celular cuando es la hora de una llamada.",
      variables: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    },
    {
      id: "cron",
      nombre: "Programador de llamadas",
      configurada: tiene("CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY"),
      paraQue: "Dispara las llamadas a su hora y las reprograma. Además hay que cargar dos valores en Supabase.",
      variables: ["CRON_SECRET"],
    },
    {
      id: "correo",
      nombre: "Correo con código (SMTP en Supabase)",
      configurada: null,
      paraQue: "Que el correo de ingreso traiga el código de 6 dígitos. Se configura en Supabase, no acá.",
      variables: [],
    },
  ];
}

export const integracionLista = (id: string) =>
  integraciones().find((i) => i.id === id)?.configurada === true;
