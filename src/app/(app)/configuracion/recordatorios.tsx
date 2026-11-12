"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { Tarjeta } from "@/components/ui/varios";
import { useDatos } from "@/lib/datos/almacen";
import { supabaseBrowser } from "@/lib/supabase/client";

type Recordatorio = { id: string; message: string; weekdays: number[]; local_time: string; active: boolean };

const MENSAJE_POR_DEFECTO = "Entrá a documentar tu día.";
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

/** Recordatorios por notificación: qué días y a qué hora avisar, y con qué texto. */
export function ConfigRecordatorios() {
  const { avisar } = useDatos();
  const [lista, setLista] = useState<Recordatorio[] | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await supabaseBrowser().from("reminders").select("id,message,weekdays,local_time,active").order("local_time");
      if (vigente) setLista((data as Recordatorio[] | null) ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  const fallo = () => avisar("No se pudo guardar. Probá de nuevo.");

  async function agregar() {
    const nuevo: Recordatorio = {
      id: crypto.randomUUID(), message: MENSAJE_POR_DEFECTO, weekdays: [1, 2, 3, 4, 5], local_time: "20:00", active: true,
    };
    setLista((l) => [...(l ?? []), nuevo]);
    const { error } = await supabaseBrowser().from("reminders").insert(nuevo);
    if (error) {
      setLista((l) => (l ?? []).filter((r) => r.id !== nuevo.id));
      avisar(/máximo/.test(error.message) ? "Llegaste al máximo de 10 recordatorios." : "No se pudo guardar. Probá de nuevo.");
    }
  }
  async function cambiar(id: string, cambios: Partial<Recordatorio>) {
    setLista((l) => (l ?? []).map((r) => (r.id === id ? { ...r, ...cambios } : r)));
    // Si cambia la hora o los días, puede volver a sonar hoy.
    const reinicio = "local_time" in cambios || "weekdays" in cambios ? { last_sent_on: null } : {};
    const { error } = await supabaseBrowser().from("reminders").update({ ...cambios, ...reinicio }).eq("id", id);
    if (error) fallo();
  }
  async function borrar(id: string) {
    setLista((l) => (l ?? []).filter((r) => r.id !== id));
    const { error } = await supabaseBrowser().from("reminders").delete().eq("id", id);
    if (error) fallo();
  }

  return (
    <Tarjeta>
      <h2 className="rotulo mb-1">Recordatorios</h2>
      <p className="mb-4 text-sm text-texto-2">
        Una notificación en el celular los días y a la hora que elijas (en tu zona horaria), para no olvidarte de entrar. Hace falta tener
        activadas las notificaciones en este dispositivo, más abajo.
      </p>
      {lista === null ? (
        <p className="text-sm text-texto-3">Cargando…</p>
      ) : (
        <>
          {lista.length ? (
            <ul className="mb-3 flex flex-col gap-3">
              {lista.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 rounded-md border border-borde p-3">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`rec-hora-${r.id}`} className="sr-only">Hora del recordatorio</label>
                    <Entrada
                      id={`rec-hora-${r.id}`}
                      type="time"
                      value={r.local_time.slice(0, 5)}
                      onChange={(e) => e.target.value && void cambiar(r.id, { local_time: e.target.value })}
                      className="!h-9 !w-32 font-medium"
                    />
                    <span className="flex-1" />
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[13px] text-texto-2">
                      <input
                        type="checkbox"
                        checked={r.active}
                        onChange={(e) => void cambiar(r.id, { active: e.target.checked })}
                        className="h-4 w-4 accent-[var(--color-acento)]"
                      />
                      Activo
                    </label>
                    <button
                      type="button"
                      aria-label={`Borrar el recordatorio de las ${r.local_time.slice(0, 5)}`}
                      onClick={() => void borrar(r.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>
                  <div role="group" aria-label="Días del recordatorio" className="flex gap-1">
                    {DIAS.map((d) => {
                      const elegido = r.weekdays.includes(d.n);
                      return (
                        <button
                          key={d.n}
                          type="button"
                          aria-pressed={elegido}
                          aria-label={d.largo}
                          onClick={() =>
                            void cambiar(r.id, { weekdays: elegido ? r.weekdays.filter((x) => x !== d.n) : [...r.weekdays, d.n].sort() })
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
                  <Campo etiqueta="Texto de la notificación" htmlFor={`rec-texto-${r.id}`}>
                    <Entrada
                      id={`rec-texto-${r.id}`}
                      defaultValue={r.message}
                      maxLength={200}
                      onBlur={(e) => {
                        const texto = e.target.value.trim() || MENSAJE_POR_DEFECTO;
                        e.target.value = texto;
                        if (texto !== r.message) void cambiar(r.id, { message: texto });
                      }}
                    />
                  </Campo>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-texto-3">Todavía no hay ninguno.</p>
          )}
          <Boton onClick={() => void agregar()}>
            <Plus size={15} aria-hidden />
            Agregar recordatorio
          </Boton>
        </>
      )}
    </Tarjeta>
  );
}
