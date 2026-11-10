"use client";

import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Etiqueta, Tarjeta } from "@/components/ui/varios";
import { estadoApp, type EstadoApp } from "@/lib/agente/cliente";
import { useDatos } from "@/lib/datos/almacen";
import { usePerfil } from "@/lib/datos/perfil";
import { AJUSTES_POR_DEFECTO, ajustesDe, VENTANA_POR_DEFECTO } from "@/lib/programacion/horarios";
import { activarPush, desactivarPush, estadoPush, type EstadoPush } from "@/lib/push/cliente";
import { supabaseBrowser } from "@/lib/supabase/client";

type Rutina = {
  id: string;
  name: string;
  weekdays: number[];
  local_time: string;
  target_minutes: number;
  focus: string | null;
  active: boolean;
};
type Ventana = { id: string; weekday: number; start_time: string; end_time: string };

// Se muestran de lunes a domingo; en la base 0 es domingo.
const DIAS = [
  { n: 1, corto: "L", largo: "Lunes" },
  { n: 2, corto: "M", largo: "Martes" },
  { n: 3, corto: "X", largo: "Miércoles" },
  { n: 4, corto: "J", largo: "Jueves" },
  { n: 5, corto: "V", largo: "Viernes" },
  { n: 6, corto: "S", largo: "Sábado" },
  { n: 0, corto: "D", largo: "Domingo" },
];

function Notificaciones({ estado }: { estado: EstadoApp | null }) {
  const { avisar } = useDatos();
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;
    void estadoPush().then((p) => vigente && setPush(p));
    return () => {
      vigente = false;
    };
  }, []);

  async function activar() {
    setOcupado(true);
    const r = await activarPush(estado?.vapid ?? "");
    if (!r.ok) avisar(r.mensaje ?? "No se pudo activar.");
    setPush(await estadoPush());
    setOcupado(false);
  }
  async function desactivar() {
    setOcupado(true);
    await desactivarPush();
    setPush(await estadoPush());
    setOcupado(false);
  }
  async function probar() {
    const r = await fetch("/api/push/probar", { method: "POST" }).then((x) => x.json()).catch(() => null);
    avisar(
      r?.ok
        ? "Enviada. Tendría que llegarte en unos segundos."
        : r?.motivo === "sin_dispositivos"
          ? "No hay ningún dispositivo con notificaciones activadas."
          : "No se pudo enviar la notificación de prueba.",
    );
  }

  return (
    <Tarjeta>
      <h2 className="rotulo mb-1 flex items-center gap-2">
        Notificaciones
        {push ? <Etiqueta tono={push === "activo" ? "ok" : "neutro"}>{push === "activo" ? "Activas en este dispositivo" : "Inactivas acá"}</Etiqueta> : null}
      </h2>
      <p className="mb-3 text-sm text-texto-2">
        A la hora de una llamada te llega una notificación y al tocarla entrás directo. Se activan por dispositivo.
      </p>
      {estado && !estado.push ? (
        <p className="mb-3 text-[13px] text-aviso">
          Faltan las claves de notificaciones en el servidor: por ahora el aviso solo aparece dentro de la app.{" "}
          <Link href="/configurar" className="underline">Ver qué falta</Link>
        </p>
      ) : null}
      {estado && !estado.cron ? (
        <p className="mb-3 text-[13px] text-aviso">
          Falta configurar el programador: sin eso las llamadas no se disparan solas.{" "}
          <Link href="/configurar" className="underline">Ver qué falta</Link>
        </p>
      ) : null}
      {push === "no_soportado" ? (
        <p className="text-[13px] text-texto-2">
          Este navegador no admite notificaciones push. En iPhone hay que instalar la app en la pantalla de inicio y abrirla desde ahí.
        </p>
      ) : push === "bloqueado" ? (
        <p className="text-[13px] text-texto-2">Están bloqueadas para este sitio. Se cambia en los ajustes del navegador o del sistema.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {push === "activo" ? (
            <>
              <Boton onClick={probar} disabled={!estado?.push}>Enviar una de prueba</Boton>
              <Boton variante="fantasma" onClick={desactivar} disabled={ocupado}>Desactivar en este dispositivo</Boton>
            </>
          ) : (
            <Boton variante="primario" onClick={activar} disabled={ocupado || !estado?.push}>Activar notificaciones</Boton>
          )}
        </div>
      )}
    </Tarjeta>
  );
}

function FilaRutina({ rutina, alCambiar, alBorrar }: { rutina: Rutina; alCambiar: (c: Partial<Rutina>) => void; alBorrar: () => void }) {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-borde p-3">
      <div className="flex items-center gap-2">
        <label htmlFor={`r-nombre-${rutina.id}`} className="sr-only">Nombre de la rutina</label>
        <Entrada
          id={`r-nombre-${rutina.id}`}
          defaultValue={rutina.name}
          maxLength={60}
          onBlur={(e) => {
            const nombre = e.target.value.trim();
            if (nombre && nombre !== rutina.name) alCambiar({ name: nombre });
            else e.target.value = rutina.name;
          }}
          className="!h-9 font-medium"
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[13px] text-texto-2">
          <input
            type="checkbox"
            checked={rutina.active}
            onChange={(e) => alCambiar({ active: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-acento)]"
          />
          Activa
        </label>
        <button
          type="button"
          aria-label={`Borrar la rutina ${rutina.name}`}
          onClick={alBorrar}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
      <div role="group" aria-label="Días de la semana" className="flex gap-1">
        {DIAS.map((d) => {
          const elegido = rutina.weekdays.includes(d.n);
          return (
            <button
              key={d.n}
              type="button"
              aria-pressed={elegido}
              aria-label={d.largo}
              onClick={() =>
                alCambiar({ weekdays: elegido ? rutina.weekdays.filter((x) => x !== d.n) : [...rutina.weekdays, d.n].sort() })
              }
              className={`h-9 flex-1 rounded-md border text-[13px] font-medium ${
                elegido ? "border-acento/60 bg-acento-suave text-acento" : "border-borde text-texto-3 hover:text-texto"
              }`}
            >
              {d.corto}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Hora" htmlFor={`r-hora-${rutina.id}`}>
          <Entrada
            id={`r-hora-${rutina.id}`}
            type="time"
            value={rutina.local_time.slice(0, 5)}
            onChange={(e) => e.target.value && alCambiar({ local_time: e.target.value })}
          />
        </Campo>
        <Campo etiqueta="Duración (minutos)" htmlFor={`r-min-${rutina.id}`}>
          <Entrada
            id={`r-min-${rutina.id}`}
            type="number"
            min={1}
            max={120}
            defaultValue={rutina.target_minutes}
            onBlur={(e) => {
              const n = Math.min(120, Math.max(1, Math.round(Number(e.target.value)) || rutina.target_minutes));
              e.target.value = String(n);
              if (n !== rutina.target_minutes) alCambiar({ target_minutes: n });
            }}
          />
        </Campo>
      </div>
      <Campo etiqueta="Foco de la llamada" htmlFor={`r-foco-${rutina.id}`} ayuda="El Agente ajusta la profundidad a esto.">
        <Entrada
          id={`r-foco-${rutina.id}`}
          defaultValue={rutina.focus ?? ""}
          maxLength={200}
          placeholder="Por ejemplo: repaso breve del día, o revisión completa de todos los proyectos"
          onBlur={(e) => {
            const foco = e.target.value.trim() || null;
            if (foco !== rutina.focus) alCambiar({ focus: foco });
          }}
        />
      </Campo>
    </li>
  );
}

/** Rutinas de llamada, disponibilidad, margen de espera y notificaciones. */
export function ConfigLlamadas() {
  const { avisar } = useDatos();
  const { perfil, guardarConfig } = usePerfil();
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [rutinas, setRutinas] = useState<Rutina[] | null>(null);
  const [ventanas, setVentanas] = useState<Ventana[]>([]);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const sb = supabaseBrowser();
      const [e, r, v] = await Promise.all([
        estadoApp(),
        sb.from("call_routines").select("id,name,weekdays,local_time,target_minutes,focus,active").order("local_time"),
        sb.from("availability_windows").select("id,weekday,start_time,end_time").order("start_time"),
      ]);
      if (!vigente) return;
      setEstado(e);
      setRutinas((r.data as Rutina[] | null) ?? []);
      setVentanas((v.data as Ventana[] | null) ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  const fallo = useCallback(() => avisar("No se pudo guardar. Probá de nuevo."), [avisar]);

  async function agregarRutina() {
    const nueva: Rutina = {
      id: crypto.randomUUID(), name: "Repaso del día", weekdays: [1, 2, 3, 4, 5], local_time: "09:00",
      target_minutes: 10, focus: "Repaso breve del día", active: true,
    };
    setRutinas((l) => [...(l ?? []), nueva]);
    const { error } = await supabaseBrowser().from("call_routines").insert(nueva);
    if (error) fallo();
  }
  async function cambiarRutina(id: string, cambios: Partial<Rutina>) {
    setRutinas((l) => (l ?? []).map((r) => (r.id === id ? { ...r, ...cambios } : r)));
    const { error } = await supabaseBrowser().from("call_routines").update(cambios).eq("id", id);
    if (error) fallo();
  }
  async function borrarRutina(id: string) {
    setRutinas((l) => (l ?? []).filter((r) => r.id !== id));
    const { error } = await supabaseBrowser().from("call_routines").delete().eq("id", id);
    if (error) fallo();
  }

  async function agregarVentana() {
    const nueva: Ventana = { id: crypto.randomUUID(), weekday: 1, start_time: "18:00", end_time: "21:00" };
    setVentanas((l) => [...l, nueva]);
    const { error } = await supabaseBrowser().from("availability_windows").insert(nueva);
    if (error) fallo();
  }
  async function cambiarVentana(id: string, cambios: Partial<Ventana>) {
    const actual = ventanas.find((v) => v.id === id);
    if (!actual) return;
    const nueva = { ...actual, ...cambios };
    // La base exige que termine después de empezar.
    if (nueva.end_time.slice(0, 5) <= nueva.start_time.slice(0, 5)) return avisar("La franja tiene que terminar después de empezar.");
    setVentanas((l) => l.map((v) => (v.id === id ? nueva : v)));
    const { error } = await supabaseBrowser().from("availability_windows").update(cambios).eq("id", id);
    if (error) fallo();
  }
  async function borrarVentana(id: string) {
    setVentanas((l) => l.filter((v) => v.id !== id));
    const { error } = await supabaseBrowser().from("availability_windows").delete().eq("id", id);
    if (error) fallo();
  }

  const ajustes = ajustesDe(perfil?.agent_config);
  const guardarNumero = async (clave: string, valor: string, min: number, max: number, defecto: number) => {
    const n = Math.min(max, Math.max(min, Math.round(Number(valor))));
    if (!(await guardarConfig({ [clave]: Number.isFinite(n) ? n : defecto }))) fallo();
  };

  return (
    <>
      <Tarjeta>
        <h2 className="rotulo mb-1">Rutinas de llamada</h2>
        <p className="mb-4 text-sm text-texto-2">
          Las llamadas las inicia el Agente en estos horarios (en tu zona horaria). Para hablar en otro momento está el chat.
        </p>
        {rutinas === null ? (
          <p className="text-sm text-texto-3">Cargando…</p>
        ) : (
          <>
            {rutinas.length ? (
              <ul className="mb-3 flex flex-col gap-3">
                {rutinas.map((r) => (
                  <FilaRutina key={r.id} rutina={r} alCambiar={(c) => void cambiarRutina(r.id, c)} alBorrar={() => void borrarRutina(r.id)} />
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-texto-3">Todavía no hay ninguna. Con una por día alcanza para empezar.</p>
            )}
            <Boton onClick={() => void agregarRutina()}>
              <Plus size={15} aria-hidden />
              Agregar rutina
            </Boton>
          </>
        )}
      </Tarjeta>

      <Tarjeta>
        <h2 className="rotulo mb-1">Disponibilidad</h2>
        <p className="mb-4 text-sm text-texto-2">
          Si no atendés, la llamada se reprograma sola al próximo hueco libre dentro de estas franjas.
          {!ventanas.length ? ` Sin franjas cargadas se usa de ${VENTANA_POR_DEFECTO.start_time} a ${VENTANA_POR_DEFECTO.end_time}, todos los días.` : ""}
        </p>
        {ventanas.length ? (
          <ul className="mb-3 flex flex-col gap-2">
            {ventanas.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                <label htmlFor={`v-dia-${v.id}`} className="sr-only">Día</label>
                <Selector id={`v-dia-${v.id}`} value={v.weekday} onChange={(e) => void cambiarVentana(v.id, { weekday: Number(e.target.value) })} className="!h-9 min-w-0 flex-1">
                  {DIAS.map((d) => (
                    <option key={d.n} value={d.n}>{d.largo}</option>
                  ))}
                </Selector>
                <label htmlFor={`v-desde-${v.id}`} className="sr-only">Desde</label>
                <Entrada id={`v-desde-${v.id}`} type="time" value={v.start_time.slice(0, 5)} onChange={(e) => e.target.value && void cambiarVentana(v.id, { start_time: e.target.value })} className="!h-9 !w-28 shrink-0" />
                <span className="text-texto-3">a</span>
                <label htmlFor={`v-hasta-${v.id}`} className="sr-only">Hasta</label>
                <Entrada id={`v-hasta-${v.id}`} type="time" value={v.end_time.slice(0, 5)} onChange={(e) => e.target.value && void cambiarVentana(v.id, { end_time: e.target.value })} className="!h-9 !w-28 shrink-0" />
                <button
                  type="button"
                  aria-label="Borrar esta franja"
                  onClick={() => void borrarVentana(v.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Boton onClick={() => void agregarVentana()}>
          <Plus size={15} aria-hidden />
          Agregar franja
        </Boton>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-borde pt-4">
          <Campo etiqueta="Margen para atender (min)" htmlFor="margen" ayuda="Pasado esto, se reprograma.">
            <Entrada
              id="margen"
              type="number"
              min={1}
              max={120}
              key={`m-${ajustes.margenMinutos}`}
              defaultValue={ajustes.margenMinutos}
              disabled={!perfil}
              onBlur={(e) => void guardarNumero("margen_minutos", e.target.value, 1, 120, AJUSTES_POR_DEFECTO.margenMinutos)}
            />
          </Campo>
          <Campo etiqueta="Reprogramaciones por día" htmlFor="maximo" ayuda="Después, se da por perdida.">
            <Entrada
              id="maximo"
              type="number"
              min={0}
              max={10}
              key={`x-${ajustes.maxReprogramaciones}`}
              defaultValue={ajustes.maxReprogramaciones}
              disabled={!perfil}
              onBlur={(e) => void guardarNumero("max_reprogramaciones", e.target.value, 0, 10, AJUSTES_POR_DEFECTO.maxReprogramaciones)}
            />
          </Campo>
        </div>
      </Tarjeta>

      <Notificaciones estado={estado} />
    </>
  );
}
