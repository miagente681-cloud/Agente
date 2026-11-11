"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Registro cerrado por defecto: el código solo sirve para cuentas que ya
 * existen. Se abre con NEXT_PUBLIC_REGISTRO_ABIERTO=true. Igual, la barrera
 * real es el ajuste «Allow new users to sign up» de Supabase (ver CREDENCIALES.md):
 * cualquiera puede llamar a la API de Supabase sin pasar por esta pantalla.
 */
const REGISTRO_ABIERTO = process.env.NEXT_PUBLIC_REGISTRO_ABIERTO === "true";

const SIN_CUENTA = "Ese correo no tiene una cuenta en MiAgente. Si te tendrían que haber dado acceso, pedíselo a quien administra la app.";

function mensajeDeError(codigo: string | undefined, status: number | undefined): string {
  // Con el registro cerrado, Supabase responde así a un correo sin cuenta.
  if (codigo === "otp_disabled" || codigo === "signup_disabled" || codigo === "user_not_found") return SIN_CUENTA;
  if (status === 429 || codigo === "over_email_send_rate_limit" || codigo === "over_request_rate_limit") {
    return "Hubo demasiados intentos. Esperá unos minutos y probá de nuevo.";
  }
  if (codigo === "invalid_credentials") {
    return "El correo o la contraseña no coinciden. Si todavía no pusiste una contraseña, entrá con un código.";
  }
  if (codigo === "otp_expired") return "El código no es correcto o ya venció. Pedí uno nuevo.";
  if (codigo === "email_not_confirmed") return "Ese correo todavía no está confirmado. Entrá con un código.";
  if (codigo === "email_address_invalid" || codigo === "validation_failed") {
    return "Revisá el correo: no parece una dirección válida.";
  }
  return "No se pudo completar. Revisá tu conexión y probá de nuevo.";
}

type Modo = "contrasena" | "codigo" | "verificar";

/**
 * Ingreso con contraseña (lo habitual) o con un código por correo (si todavía
 * no tenés contraseña, o te la olvidaste). La contraseña se pone en Configuración.
 */
export function FormularioIngreso() {
  const router = useRouter();
  const params = useSearchParams();
  const [modo, setModo] = useState<Modo>("contrasena");
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "enlace" ? "El enlace no sirvió o ya venció. Pedí uno nuevo." : null,
  );

  const entrar = () => {
    router.replace("/hoy");
    router.refresh();
  };
  const cambiar = (nuevo: Modo) => {
    setModo(nuevo);
    setError(null);
    setCodigo("");
  };

  async function conContrasena(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: correo.trim(), password: contrasena });
    if (error) {
      setCargando(false);
      return setError(mensajeDeError(error.code, error.status));
    }
    entrar();
  }

  async function pedirCodigo(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: correo.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirmar`, shouldCreateUser: REGISTRO_ABIERTO },
    });
    setCargando(false);
    if (error) return setError(mensajeDeError(error.code, error.status));
    setModo("verificar");
  }

  async function verificarCodigo(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: correo.trim(), token: codigo.trim(), type: "email" });
    if (error) {
      setCargando(false);
      return setError(mensajeDeError(error.code, error.status));
    }
    entrar();
  }

  const campoCorreo = (
    <Campo etiqueta="Correo" htmlFor="correo">
      <Entrada
        id="correo"
        type="email"
        name="email"
        autoComplete="username"
        inputMode="email"
        required
        autoFocus={!correo}
        placeholder="vos@ejemplo.com"
        value={correo}
        onChange={(e) => setCorreo(e.target.value)}
      />
    </Campo>
  );

  if (modo === "contrasena") {
    return (
      <form onSubmit={conContrasena} className="flex flex-col gap-4">
        {campoCorreo}
        <Campo etiqueta="Contraseña" htmlFor="contrasena" error={error}>
          <Entrada
            id="contrasena"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
          />
        </Campo>
        <Boton type="submit" variante="primario" disabled={cargando || !correo.trim() || !contrasena}>
          {cargando ? "Entrando…" : "Entrar"}
        </Boton>
        <p className="text-center text-[13px] text-texto-2">
          {REGISTRO_ABIERTO ? "¿Primera vez, o te olvidaste la contraseña?" : "¿Todavía no tenés contraseña, o te la olvidaste?"}{" "}
          <button type="button" onClick={() => cambiar("codigo")} className="rounded-sm font-medium text-acento hover:text-acento-fuerte">
            Entrar con un código
          </button>
        </p>
      </form>
    );
  }

  if (modo === "codigo") {
    return (
      <form onSubmit={pedirCodigo} className="flex flex-col gap-4">
        {campoCorreo}
        {error ? (
          <p role="alert" className="text-[13px] text-peligro">
            {error}
          </p>
        ) : null}
        <Boton type="submit" variante="primario" disabled={cargando || !correo.trim()}>
          {cargando ? "Enviando…" : "Enviarme el acceso"}
        </Boton>
        <p className="text-[13px] text-texto-3">
          Te llega un correo con un enlace y un código.{" "}
          {REGISTRO_ABIERTO
            ? "Si es tu primera vez, se crea tu cuenta."
            : "Solo funciona con una cuenta que ya exista: el registro de cuentas nuevas está cerrado."}{" "}
          Una vez adentro, ponete una contraseña en Configuración y la próxima entrás directo.
        </p>
        <Boton variante="fantasma" onClick={() => cambiar("contrasena")}>
          Entrar con contraseña
        </Boton>
      </form>
    );
  }

  return (
    <form onSubmit={verificarCodigo} className="flex flex-col gap-4">
      <p className="text-sm text-texto-2">
        Te mandamos un correo a <span className="text-texto">{correo.trim()}</span>. Abrí el enlace en este mismo
        dispositivo o escribí acá el código.
      </p>
      <Campo
        etiqueta="Código del correo"
        htmlFor="codigo"
        error={error}
        ayuda="Si instalaste la app en el celular, usá el código: el enlace abre el navegador, no la app."
      >
        <Entrada
          id="codigo"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6,10}"
          maxLength={10}
          required
          autoFocus
          placeholder="123456"
          className="font-mono tracking-[0.3em]"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
        />
      </Campo>
      <Boton type="submit" variante="primario" disabled={cargando || codigo.length < 6}>
        {cargando ? "Verificando…" : "Entrar"}
      </Boton>
      <Boton variante="fantasma" onClick={() => cambiar("codigo")}>
        Usar otro correo o reenviar
      </Boton>
    </form>
  );
}
