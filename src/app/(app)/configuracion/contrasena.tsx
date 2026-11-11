"use client";

import { useState, type FormEvent } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { supabaseBrowser } from "@/lib/supabase/client";

export const LARGO_MINIMO = 8;

/** Poner o cambiar la contraseña de la cuenta, con la sesión abierta. */
export function Contrasena({ correo }: { correo: string }) {
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const problema =
    nueva && nueva.length < LARGO_MINIMO
      ? `Tiene que tener al menos ${LARGO_MINIMO} caracteres.`
      : repetida && repetida !== nueva
        ? "Las dos no coinciden."
        : null;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (problema || !nueva || nueva !== repetida) return;
    setGuardando(true);
    setAviso(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password: nueva });
    setGuardando(false);
    if (error) {
      const texto =
        error.code === "same_password"
          ? "Esa ya es tu contraseña."
          : error.code === "weak_password"
            ? "Es demasiado débil. Probá con una más larga."
            : error.code === "reauthentication_needed"
              ? "Por seguridad, cerrá sesión, entrá con un código y volvé a intentarlo."
              : "No se pudo guardar. Probá de nuevo.";
      return setAviso({ ok: false, texto });
    }
    setNueva("");
    setRepetida("");
    setAviso({ ok: true, texto: "Listo. Desde ahora podés entrar con tu correo y esta contraseña." });
  }

  return (
    <form onSubmit={guardar} className="mt-5 flex flex-col gap-4 border-t border-borde pt-5">
      <div>
        <h3 className="text-sm font-medium">Contraseña</h3>
        <p className="mt-1 text-[13px] text-texto-2">
          Con una contraseña entrás directo desde cualquier dispositivo, sin esperar el correo. Si la olvidás, entrás con
          un código y la cambiás acá.
        </p>
      </div>
      {/* Para que el gestor de contraseñas del navegador la guarde con el correo correcto. */}
      <input type="email" name="username" autoComplete="username" value={correo} readOnly hidden />
      <Campo etiqueta="Nueva contraseña" htmlFor="nueva-contrasena" ayuda={`Al menos ${LARGO_MINIMO} caracteres.`}>
        <Entrada
          id="nueva-contrasena"
          type="password"
          autoComplete="new-password"
          minLength={LARGO_MINIMO}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
        />
      </Campo>
      <Campo etiqueta="Repetila" htmlFor="repetir-contrasena" error={problema}>
        <Entrada
          id="repetir-contrasena"
          type="password"
          autoComplete="new-password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
        />
      </Campo>
      <div className="flex flex-wrap items-center gap-3">
        <Boton type="submit" disabled={guardando || Boolean(problema) || !nueva || nueva !== repetida}>
          {guardando ? "Guardando…" : "Guardar contraseña"}
        </Boton>
        {aviso ? (
          <p role="status" className={`text-sm ${aviso.ok ? "text-ok" : "text-peligro"}`}>
            {aviso.texto}
          </p>
        ) : null}
      </div>
    </form>
  );
}
