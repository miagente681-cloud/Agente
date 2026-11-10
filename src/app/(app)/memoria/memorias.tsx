"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Selector } from "@/components/ui/campo";
import { EncabezadoPagina, Vacio } from "@/components/ui/varios";
import { useDatos } from "@/lib/datos/almacen";
import { supabaseBrowser } from "@/lib/supabase/client";

type Memoria = {
  id: string;
  category: string;
  content: string;
  source_session_id: string | null;
  edited_by_user: boolean;
  updated_at: string;
};

const CATEGORIAS: { valor: string; nombre: string; ayuda: string }[] = [
  { valor: "objetivo", nombre: "Objetivos", ayuda: "Lo que querés lograr." },
  { valor: "rutina", nombre: "Rutinas y horarios", ayuda: "Cómo es tu semana y a qué hora rendís." },
  { valor: "preferencia", nombre: "Cómo te gusta trabajar", ayuda: "" },
  { valor: "obstaculo_recurrente", nombre: "Lo que suele frenarte", ayuda: "" },
  { valor: "solucion_que_funciono", nombre: "Lo que te funcionó", ayuda: "" },
  { valor: "contexto_personal", nombre: "Contexto personal", ayuda: "" },
];

function Fila({ memoria, alCambiar }: { memoria: Memoria; alCambiar: (m: Memoria | null) => void }) {
  const { avisar } = useDatos();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(memoria.content);
  const [categoria, setCategoria] = useState(memoria.category);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const contenido = texto.trim();
    if (!contenido) return;
    // edited_by_user: desde ahora el Agente no la pisa.
    const cambios = { content: contenido, category: categoria, edited_by_user: true };
    const { error } = await supabaseBrowser().from("memories").update(cambios).eq("id", memoria.id);
    if (error) return avisar("No se pudo guardar.");
    alCambiar({ ...memoria, ...cambios });
    setEditando(false);
  }

  async function borrar() {
    const { error } = await supabaseBrowser().from("memories").delete().eq("id", memoria.id);
    if (error) return avisar("No se pudo borrar.");
    alCambiar(null);
  }

  if (editando) {
    return (
      <li className="border-b border-borde py-3 last:border-b-0">
        <form onSubmit={guardar} className="flex flex-col gap-2">
          <label htmlFor={`m-${memoria.id}`} className="sr-only">
            Texto de la memoria
          </label>
          <AreaTexto id={`m-${memoria.id}`} autoFocus value={texto} maxLength={500} onChange={(e) => setTexto(e.target.value)} className="!min-h-16" />
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`c-${memoria.id}`} className="sr-only">
              Categoría
            </label>
            <Selector id={`c-${memoria.id}`} value={categoria} onChange={(e) => setCategoria(e.target.value)} className="!h-8 !w-auto !text-[13px]">
              {CATEGORIAS.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.nombre}
                </option>
              ))}
            </Selector>
            <Boton type="submit" tamano="sm" variante="primario" disabled={!texto.trim()}>
              Guardar
            </Boton>
            <Boton tamano="sm" variante="fantasma" onClick={() => setEditando(false)}>
              Cancelar
            </Boton>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 border-b border-borde py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p>{memoria.content}</p>
        <p className="mt-0.5 text-xs text-texto-3">
          {memoria.edited_by_user ? "La escribiste o corregiste vos" : "La anotó el Agente"}
          {memoria.source_session_id ? (
            <>
              {" · "}
              <Link href={`/sesiones/${memoria.source_session_id}`} className="underline hover:text-texto">
                ver la sesión de donde salió
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        aria-label={`Editar: ${memoria.content}`}
        onClick={() => setEditando(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
      >
        <Pencil size={14} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Borrar: ${memoria.content}`}
        onClick={() => void borrar()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-texto-3 hover:bg-elevado hover:text-texto"
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </li>
  );
}

export function Memorias() {
  const { avisar } = useDatos();
  const [memorias, setMemorias] = useState<Memoria[] | null>(null);
  const [nueva, setNueva] = useState("");
  const [categoria, setCategoria] = useState("preferencia");

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await supabaseBrowser()
        .from("memories")
        .select("id,category,content,source_session_id,edited_by_user,updated_at")
        .is("archived_at", null)
        .order("updated_at", { ascending: false });
      if (vigente) setMemorias((data as Memoria[] | null) ?? []);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const contenido = nueva.trim();
    if (!contenido) return;
    const fila = { id: crypto.randomUUID(), category: categoria, content: contenido, edited_by_user: true };
    const { error } = await supabaseBrowser().from("memories").insert(fila);
    if (error) return avisar("No se pudo guardar.");
    setMemorias((l) => [{ ...fila, source_session_id: null, updated_at: new Date().toISOString() }, ...(l ?? [])]);
    setNueva("");
  }

  const alCambiar = (id: string) => (m: Memoria | null) =>
    setMemorias((l) => (l ?? []).flatMap((x) => (x.id === id ? (m ? [m] : []) : [x])));

  return (
    <>
      <EncabezadoPagina
        titulo="Lo que sé de vos"
        descripcion="Lo que el Agente aprendió hablando con vos. Corregí lo que esté mal: lo que edites, no lo pisa."
      />
      {memorias === null ? (
        <p className="text-sm text-texto-3">Cargando…</p>
      ) : (
        <div className="flex max-w-2xl flex-col gap-6">
          {!memorias.length ? (
            <Vacio
              titulo="Todavía no sé nada de vos"
              accion={
                <Link href="/bienvenida" className="inline-flex h-10 items-center rounded-md bg-acento px-4 text-sm font-medium text-sobre-acento hover:bg-acento-fuerte">
                  Hacer la entrevista inicial
                </Link>
              }
            >
              Después de cada charla o llamada anoto acá qué te frena, a qué hora rendís mejor y qué soluciones te
              funcionaron. La entrevista inicial es la forma más rápida de empezar.
            </Vacio>
          ) : null}

          {CATEGORIAS.map((c) => {
            const lista = memorias.filter((m) => m.category === c.valor);
            if (!lista.length) return null;
            return (
              <section key={c.valor} className="flex flex-col gap-2">
                <h2 className="rotulo">
                  {c.nombre} <span className="font-normal opacity-70">· {lista.length}</span>
                </h2>
                <ul className="rounded-lg border border-borde bg-panel px-3.5">
                  {lista.map((m) => (
                    <Fila key={m.id} memoria={m} alCambiar={alCambiar(m.id)} />
                  ))}
                </ul>
              </section>
            );
          })}

          <form onSubmit={agregar} className="flex flex-col gap-2 border-t border-borde pt-5">
            <label htmlFor="memoria-nueva" className="rotulo">
              Agregar algo que el Agente tenga que saber
            </label>
            <AreaTexto
              id="memoria-nueva"
              value={nueva}
              maxLength={500}
              placeholder="Por ejemplo: los miércoles a la tarde no cuento con tiempo"
              onChange={(e) => setNueva(e.target.value)}
              className="!min-h-16"
            />
            <div className="flex items-center justify-end gap-2">
              <label htmlFor="memoria-categoria" className="sr-only">
                Categoría
              </label>
              <Selector id="memoria-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} className="!h-8 !w-auto !text-[13px]">
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.nombre}
                  </option>
                ))}
              </Selector>
              <Boton type="submit" tamano="sm" disabled={!nueva.trim()}>
                Agregar
              </Boton>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
