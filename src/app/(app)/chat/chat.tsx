"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { TarjetaCambio, type CambioVista } from "@/components/agente/tarjeta-cambio";
import { Boton } from "@/components/ui/boton";
import { EncabezadoPagina } from "@/components/ui/varios";
import { estadoApp, fraseCambioProveedor, pedirTurno, type EstadoApp, type PedidoTurno } from "@/lib/agente/cliente";
import { useDatos } from "@/lib/datos/almacen";
import { supabaseBrowser } from "@/lib/supabase/client";

type Item = {
  id: string;
  rol: "usuario" | "agente";
  texto: string;
  cambios: CambioVista[];
  nota?: string;
  error?: string;
  escribiendo?: boolean;
};

const HORAS_PARA_CERRAR = 6;

const TITULO: Record<string, string> = {
  chat: "Agente",
  onboarding: "Entrevista inicial",
  llamada_programada: "Llamada, por escrito",
};

export function Chat() {
  const router = useRouter();
  const params = useSearchParams();
  const { recargar } = useDatos();
  const pedida = params.get("sesion");
  const tipoPedido = params.get("tipo") === "onboarding" ? "onboarding" : "chat";

  const [sesion, setSesion] = useState<{ id: string; kind: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const abrio = useRef(false);

  const editar = (id: string, cambio: (i: Item) => Item) =>
    setItems((lista) => lista.map((i) => (i.id === id ? cambio(i) : i)));

  const enviar = useCallback(
    async (pedido: PedidoTurno, sesionId: string | null) => {
      setEnviando(true);
      const idAgente = crypto.randomUUID();
      setItems((l) => [
        ...l,
        ...(pedido.texto ? [{ id: crypto.randomUUID(), rol: "usuario" as const, texto: pedido.texto, cambios: [] }] : []),
        { id: idAgente, rol: "agente", texto: "", cambios: [], escribiendo: true },
      ]);
      let huboCambios = false;
      for await (const e of pedirTurno({ ...pedido, ...(sesionId ? { sesionId } : {}) })) {
        if (e.tipo === "sesion") setSesion((s) => s ?? { id: e.id, kind: pedido.tipo ?? "chat" });
        else if (e.tipo === "texto") editar(idAgente, (i) => ({ ...i, texto: i.texto + e.texto }));
        else if (e.tipo === "reiniciar") editar(idAgente, (i) => ({ ...i, texto: "" }));
        else if (e.tipo === "cambio") {
          huboCambios = true;
          editar(idAgente, (i) => ({ ...i, cambios: [...i.cambios, e.cambio] }));
        } else if (e.tipo === "cambio_proveedor") {
          editar(idAgente, (i) => ({ ...i, nota: fraseCambioProveedor(e.de, e.motivo) }));
        } else if (e.tipo === "error") editar(idAgente, (i) => ({ ...i, error: e.mensaje }));
      }
      editar(idAgente, (i) => ({ ...i, texto: i.texto.trim(), escribiendo: false }));
      setEnviando(false);
      // Lo que cambió el Agente tiene que verse en el resto del panel.
      if (huboCambios) void recargar();
    },
    [recargar],
  );

  useEffect(() => {
    let vigente = true;
    void estadoApp().then((e) => vigente && setEstado(e));
    (async () => {
      const sb = supabaseBrowser();
      let consulta = sb.from("sessions").select("id,kind,status");
      consulta = pedida
        ? consulta.eq("id", pedida)
        : consulta.eq("status", "en_curso").eq("kind", tipoPedido).order("created_at", { ascending: false }).limit(1);
      const { data } = await consulta;
      const abierta = (data as { id: string; kind: string; status: string }[] | null)?.[0];
      if (!vigente) return;
      if (abierta && abierta.status !== "en_curso") return router.replace(`/sesiones/${abierta.id}`);

      if (abierta) {
        const [mensajes, cambios] = await Promise.all([
          sb.from("messages").select("id,role,content,created_at").eq("session_id", abierta.id).in("role", ["usuario", "agente"]).order("created_at").limit(300),
          sb.from("change_log").select("id,message_id,operation,summary,undone_at").eq("session_id", abierta.id).order("created_at"),
        ]);
        if (!vigente) return;
        // Una charla abandonada hace horas se cierra sola (así se aprende de ella)
        // y se empieza una nueva, salvo que se haya pedido esa sesión en particular.
        const filas = (mensajes.data ?? []) as { created_at: string }[];
        const ultima = filas.at(-1)?.created_at;
        if (!pedida && ultima && Date.now() - new Date(ultima).getTime() > HORAS_PARA_CERRAR * 3_600_000) {
          void fetch(`/api/sesiones/${abierta.id}/cerrar`, { method: "POST" }).catch(() => null);
          setCargando(false);
          return;
        }
        const porMensaje = new Map<string, CambioVista[]>();
        for (const c of (cambios.data ?? []) as (CambioVista & { message_id: string | null })[]) {
          porMensaje.set(c.message_id ?? "", [...(porMensaje.get(c.message_id ?? "") ?? []), c]);
        }
        setItems(
          ((mensajes.data ?? []) as { id: string; role: "usuario" | "agente"; content: string | null }[])
            .map((m) => ({ id: m.id, rol: m.role, texto: m.content ?? "", cambios: porMensaje.get(m.id) ?? [] }))
            .filter((i) => i.texto || i.cambios.length),
        );
        setSesion({ id: abierta.id, kind: abierta.kind });
      }
      setCargando(false);
      // La entrevista inicial la abre el Agente.
      if (!abierta && tipoPedido === "onboarding" && !abrio.current) {
        abrio.current = true;
        void enviar({ inicio: true, tipo: "onboarding" }, null);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [pedida, tipoPedido, router, enviar]);

  useEffect(() => {
    fin.current?.scrollIntoView({ block: "end" });
  }, [items]);

  function alEnviar(e?: FormEvent) {
    e?.preventDefault();
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setTexto("");
    void enviar({ texto: limpio, tipo: tipoPedido }, sesion?.id ?? null);
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envía; Shift+Enter hace un salto de línea.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      alEnviar();
    }
  }

  async function terminar() {
    if (!sesion) return;
    setCerrando(true);
    await fetch(`/api/sesiones/${sesion.id}/cerrar`, { method: "POST" }).catch(() => null);
    void recargar();
    router.push(`/sesiones/${sesion.id}`);
  }

  const hayDichos = items.some((i) => i.rol === "usuario");

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col md:min-h-[calc(100dvh-5rem)]">
      <EncabezadoPagina
        titulo={TITULO[sesion?.kind ?? tipoPedido] ?? "Agente"}
        descripcion="Contale qué hiciste o qué te frena. Actualiza el panel por vos."
        acciones={
          <div className="flex shrink-0 items-center gap-1">
            <Link href="/sesiones" className="rounded-md px-2 py-1.5 text-[13px] text-texto-2 hover:text-texto">
              Sesiones
            </Link>
            {sesion && hayDichos ? (
              <Boton tamano="sm" onClick={terminar} disabled={cerrando || enviando}>
                {cerrando ? "Cerrando…" : "Terminar"}
              </Boton>
            ) : null}
          </div>
        }
      />

      {estado && !estado.agente ? (
        <p className="mb-4 rounded-lg border border-aviso/40 bg-panel px-3.5 py-3 text-sm text-texto-2">
          <span className="font-medium text-aviso">Falta configurar el cerebro del Agente.</span> Cargá la clave de
          Gemini o de Groq y volvé a desplegar.{" "}
          <Link href="/configurar" className="font-medium text-acento hover:text-acento-fuerte">
            Ver qué falta
          </Link>
        </p>
      ) : null}

      <div className="flex flex-1 flex-col gap-4" aria-live="polite">
        {cargando ? (
          <p className="text-sm text-texto-3">Cargando…</p>
        ) : !items.length ? (
          <div className="my-auto flex flex-col gap-2 py-8 text-sm text-texto-2">
            <p className="font-medium text-texto">Probá con algo así:</p>
            {[
              "Terminé de pedir el presupuesto y lo de los azulejos está trabado porque espero una respuesta",
              "¿Qué tengo vencido y por dónde arranco?",
              "Tengo que organizar un viaje a fin de mes, armame el proyecto",
            ].map((ejemplo) => (
              <button
                key={ejemplo}
                type="button"
                onClick={() => setTexto(ejemplo)}
                className="rounded-md border border-borde px-3 py-2 text-left hover:border-borde-fuerte hover:text-texto"
              >
                {ejemplo}
              </button>
            ))}
          </div>
        ) : null}

        {items.map((i) =>
          i.rol === "usuario" ? (
            <p key={i.id} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-elevado px-3.5 py-2">
              {i.texto}
            </p>
          ) : (
            <div key={i.id} className="flex max-w-[92%] flex-col gap-2 self-start">
              {i.nota ? <p className="text-xs text-texto-3">{i.nota}</p> : null}
              {i.texto ? (
                <p className="whitespace-pre-wrap leading-relaxed">{i.texto}</p>
              ) : i.escribiendo && !i.cambios.length ? (
                <p className="text-sm text-texto-3" aria-label="El Agente está escribiendo">
                  Pensando…
                </p>
              ) : null}
              {i.cambios.map((c) => (
                <TarjetaCambio key={c.id || c.summary} cambio={c} />
              ))}
              {i.error ? (
                <p role="alert" className="rounded-md border border-peligro/30 bg-peligro-suave px-3 py-2 text-sm text-peligro">
                  {i.error}
                </p>
              ) : null}
            </div>
          ),
        )}
        <div ref={fin} />
      </div>

      <form
        onSubmit={alEnviar}
        className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-4 flex items-end gap-2 rounded-xl border border-borde-fuerte bg-elevado p-1.5 md:bottom-4"
      >
        <label htmlFor="mensaje" className="sr-only">
          Mensaje para el Agente
        </label>
        <textarea
          id="mensaje"
          rows={1}
          value={texto}
          maxLength={4000}
          placeholder="Escribile al Agente…"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          enterKeyHint="send"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-[15px] placeholder:text-texto-3 focus:outline-none [field-sizing:content]"
        />
        <Boton
          type="submit"
          variante="primario"
          aria-label="Enviar"
          disabled={!texto.trim() || enviando}
          className="!h-9 !w-9 shrink-0 !rounded-lg !px-0"
        >
          <ArrowUp size={18} aria-hidden />
        </Boton>
      </form>
    </div>
  );
}
