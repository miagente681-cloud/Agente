"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Boton } from "@/components/ui/boton";
import { estadoApp, type EstadoApp } from "@/lib/agente/cliente";
import { useDatos } from "@/lib/datos/almacen";
import { activarPush, esIOS, estadoPush, instalada, type EstadoPush } from "@/lib/push/cliente";
import { supabaseBrowser } from "@/lib/supabase/client";

function Paso({
  numero,
  titulo,
  listo,
  children,
}: {
  numero: number;
  titulo: string;
  listo: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5 rounded-lg border border-borde bg-panel p-4">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs ${
          listo ? "bg-ok-suave text-ok" : "bg-elevado text-texto-2"
        }`}
      >
        {listo ? <Check size={14} aria-label="Listo" /> : numero}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="font-medium">{titulo}</h2>
        {children}
      </div>
    </li>
  );
}

/** Primeros pasos: instalar, dar permisos y hacer la entrevista inicial. */
export function Bienvenida() {
  const router = useRouter();
  const { avisar } = useDatos();
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [esInstalada, setEsInstalada] = useState(false);
  const [ios, setIos] = useState(false);
  const [push, setPush] = useState<EstadoPush>("sin_permiso");
  const [microfono, setMicrofono] = useState<"sin_pedir" | "ok" | "negado">("sin_pedir");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const [e, p] = await Promise.all([estadoApp(), estadoPush()]);
      // Si el permiso ya estaba dado, no hace falta volver a pedirlo.
      const permiso = await navigator.permissions?.query({ name: "microphone" as PermissionName }).catch(() => null);
      if (!vigente) return;
      setEstado(e);
      setPush(p);
      setEsInstalada(instalada());
      setIos(esIOS());
      if (permiso?.state === "granted") setMicrofono("ok");
      if (permiso?.state === "denied") setMicrofono("negado");
    })();
    return () => {
      vigente = false;
    };
  }, []);

  async function pedirNotificaciones() {
    setOcupado(true);
    const r = await activarPush(estado?.vapid ?? "");
    setOcupado(false);
    if (!r.ok) avisar(r.mensaje ?? "No se pudo activar.");
    setPush(await estadoPush());
  }

  async function pedirMicrofono() {
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
      flujo.getTracks().forEach((t) => t.stop());
      setMicrofono("ok");
    } catch {
      setMicrofono("negado");
    }
  }

  // La entrevista es la única llamada que empieza la persona; el resto las inicia el Agente.
  async function entrevistaPorVoz() {
    setOcupado(true);
    const { data } = await supabaseBrowser()
      .from("sessions")
      .insert({ kind: "onboarding", channel: "voz", status: "en_curso" })
      .select("id")
      .single();
    setOcupado(false);
    if (!data) return avisar("No se pudo empezar. Probá de nuevo.");
    router.push(`/llamada/${(data as { id: string }).id}`);
  }

  async function saltar() {
    await supabaseBrowser().from("profiles").update({ onboarding_done: true }).not("user_id", "is", null);
    router.replace("/hoy");
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <header>
        <h1 className="titulo-pagina">Empecemos</h1>
        <p className="mt-1 text-sm text-texto-2">
          Cuatro pasos y queda todo andando. Los tres primeros son para que el Agente pueda llamarte; el último, para
          que te conozca.
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        <Paso numero={1} titulo="Instalá la app en tu celular" listo={esInstalada}>
          {esInstalada ? (
            <p className="text-sm text-texto-2">Ya la estás usando instalada.</p>
          ) : ios ? (
            <ol className="list-decimal space-y-1 pl-4 text-sm text-texto-2">
              <li>Abrí esta página en Safari.</li>
              <li>Tocá el botón Compartir (el cuadrado con la flecha hacia arriba).</li>
              <li>Elegí «Agregar a inicio» y confirmá.</li>
              <li>Abrí MiAgente desde el ícono nuevo y volvé a este paso.</li>
            </ol>
          ) : (
            <p className="text-sm text-texto-2">
              En Android: menú del navegador (⋮) → «Instalar app» o «Agregar a la pantalla principal». En la
              computadora: el ícono de instalar en la barra de direcciones.
            </p>
          )}
          {ios && !esInstalada ? (
            <p className="text-[13px] text-aviso">
              En iPhone es obligatorio: sin instalarla no llegan las notificaciones de las llamadas. Para entrar
              desde la app instalada usá el código del correo, no el enlace.
            </p>
          ) : null}
        </Paso>

        <Paso numero={2} titulo="Permitime avisarte de las llamadas" listo={push === "activo"}>
          <p className="text-sm text-texto-2">
            Una PWA no puede hacer sonar el teléfono: a la hora de la llamada te llega una notificación y al tocarla
            entrás directo.
          </p>
          {push === "activo" ? null : push === "no_soportado" ? (
            <p className="text-[13px] text-aviso">
              {ios ? "Primero instalá la app (paso 1) y abrila desde el ícono." : "Este navegador no admite notificaciones push."}
            </p>
          ) : push === "bloqueado" ? (
            <p className="text-[13px] text-aviso">
              Las notificaciones están bloqueadas para este sitio. Se cambia desde los ajustes del navegador o del sistema.
            </p>
          ) : estado && !estado.push ? (
            <p className="text-[13px] text-aviso">
              Falta configurar las claves de notificaciones en el servidor.{" "}
              <Link href="/configurar" className="underline">
                Ver qué falta
              </Link>
            </p>
          ) : (
            <Boton className="self-start" onClick={pedirNotificaciones} disabled={ocupado || !estado}>
              Activar notificaciones
            </Boton>
          )}
        </Paso>

        <Paso numero={3} titulo="Permitime escucharte" listo={microfono === "ok"}>
          <p className="text-sm text-texto-2">Para las llamadas de voz necesito el micrófono. Solo se usa durante una llamada.</p>
          {microfono === "sin_pedir" ? (
            <Boton className="self-start" onClick={pedirMicrofono}>
              Dar permiso de micrófono
            </Boton>
          ) : microfono === "negado" ? (
            <p className="text-[13px] text-aviso">
              El micrófono está bloqueado. Podés habilitarlo en los ajustes del sitio, o hacer todo por escrito.
            </p>
          ) : null}
        </Paso>

        <Paso numero={4} titulo="La entrevista inicial" listo={false}>
          <p className="text-sm text-texto-2">
            Unos diez minutos. Te pregunto por tus áreas de vida, tus proyectos, tus horarios y qué suele frenarte, y
            con eso armo tus primeros proyectos y lo que sé de vos.
          </p>
          {estado && !estado.agente ? (
            <p className="text-[13px] text-aviso">
              Falta configurar el cerebro del Agente (Gemini o Groq).{" "}
              <Link href="/configurar" className="underline">
                Ver qué falta
              </Link>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Boton variante="primario" onClick={entrevistaPorVoz} disabled={ocupado}>
              Hacerla hablando
            </Boton>
            <Link
              href="/chat?tipo=onboarding"
              className="inline-flex h-10 items-center rounded-md border border-borde bg-elevado px-4 text-sm font-medium hover:border-borde-fuerte"
            >
              Hacerla por escrito
            </Link>
          </div>
        </Paso>
      </ol>

      <button type="button" onClick={saltar} className="self-start rounded-sm text-[13px] text-texto-3 hover:text-texto">
        Saltar por ahora y cargar todo a mano
      </button>
    </div>
  );
}
