"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Tarjeta } from "@/components/ui/varios";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Contrasena } from "./contrasena";

const ZONA_POR_DEFECTO = "America/Montevideo";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "error" }
  | { tipo: "listo"; userId: string; correo: string };

export function Cuenta() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState(ZONA_POR_DEFECTO);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const zonas = useMemo(() => {
    const todas =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [ZONA_POR_DEFECTO];
    return todas.includes(zona) ? todas : [zona, ...todas];
  }, [zona]);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const supabase = supabaseBrowser();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return router.replace("/ingresar");
      const { data, error } = await supabase
        .from("profiles")
        .select("name, timezone")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!vigente) return;
      if (error) return setEstado({ tipo: "error" });
      setNombre(data?.name ?? "");
      setZona(data?.timezone ?? ZONA_POR_DEFECTO);
      setEstado({ tipo: "listo", userId: auth.user.id, correo: auth.user.email ?? "" });
    })();
    return () => {
      vigente = false;
    };
  }, [router]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (estado.tipo !== "listo") return;
    setGuardando(true);
    setAviso(null);
    const { data, error } = await supabaseBrowser()
      .from("profiles")
      .update({ name: nombre.trim() || null, timezone: zona })
      .eq("user_id", estado.userId)
      .select("user_id");
    setGuardando(false);
    setAviso(
      error || !data?.length
        ? { ok: false, texto: "No se pudo guardar. Probá de nuevo." }
        : { ok: true, texto: "Guardado." },
    );
  }

  async function salir() {
    await supabaseBrowser().auth.signOut();
    router.replace("/ingresar");
    router.refresh();
  }

  if (estado.tipo === "cargando") {
    return <p className="text-sm text-texto-3">Cargando tu perfil…</p>;
  }
  if (estado.tipo === "error") {
    return (
      <Tarjeta>
        <p className="font-medium">No se pudo cargar tu perfil</p>
        <p className="mt-1 text-sm text-texto-2">
          Revisá la conexión. Si recién se creó el proyecto de Supabase, puede faltar aplicar la
          migración de la base.
        </p>
        <Boton className="mt-4" onClick={() => window.location.reload()}>
          Reintentar
        </Boton>
      </Tarjeta>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Tarjeta>
        <h2 className="rotulo mb-4">Perfil</h2>
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <Campo etiqueta="Nombre" htmlFor="nombre" ayuda="Así te va a llamar el Agente.">
            <Entrada
              id="nombre"
              name="name"
              autoComplete="given-name"
              maxLength={80}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </Campo>
          <Campo
            etiqueta="Zona horaria"
            htmlFor="zona"
            ayuda="Las llamadas y las fechas límite se calculan con esta zona."
          >
            <Selector id="zona" value={zona} onChange={(e) => setZona(e.target.value)}>
              {zonas.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </Selector>
          </Campo>
          <div className="flex items-center gap-3">
            <Boton type="submit" variante="primario" disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Boton>
            <p role="status" className={`text-sm ${aviso?.ok ? "text-ok" : "text-peligro"}`}>
              {aviso?.texto}
            </p>
          </div>
        </form>
      </Tarjeta>

      <Tarjeta>
        <h2 className="rotulo mb-4">Cuenta</h2>
        <p className="text-sm text-texto-2">
          Entraste como <span className="text-texto">{estado.correo}</span>
        </p>
        <Boton className="mt-4" onClick={salir}>
          Cerrar sesión
        </Boton>
        <Contrasena correo={estado.correo} />
      </Tarjeta>
    </div>
  );
}
