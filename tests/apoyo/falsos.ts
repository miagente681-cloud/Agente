import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ErrorProveedor, type ClaseError, type PedidoLLM, type ProveedorLLM, type Trozo } from "@/lib/agente/tipos";
// Los servidores de mentira son CommonJS porque también los usa la recorrida en navegador.
import supabaseFalso from "../recorrida/supabase-falso.cjs";
import modelosFalsos from "../recorrida/modelos-falsos.cjs";

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type ServidorSupabase = Server & {
  estado: () => Record<string, Fila[]>;
  reiniciar: () => void;
  sembrar: (tabla: string, fila: Fila) => Fila;
};
export type PasoModelo = {
  proveedor?: string;
  siSistema?: string;
  estado?: number;
  mensaje?: string;
  texto?: string;
  llamadas?: { nombre: string; argumentos: unknown }[];
  cortar?: boolean;
};
export type ServidorModelos = Server & {
  guion: (pasos: PasoModelo[]) => void;
  pedidos: () => { proveedor: string; cuerpo: Fila; cabeceras: Fila }[];
  reiniciar: () => void;
};

export const USUARIO: { id: string } = supabaseFalso.USUARIO;

const escuchar = (s: Server) =>
  new Promise<string>((listo) => s.listen(0, "127.0.0.1", () => listo(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

/** Supabase de mentira + el cliente real de supabase-js apuntando a él. */
export async function levantarSupabase(): Promise<{ servidor: ServidorSupabase; sb: SupabaseClient; url: string }> {
  const servidor = supabaseFalso.crearServidor() as ServidorSupabase;
  const url = await escuchar(servidor);
  const sb = createClient(url, "clave-falsa", { auth: { persistSession: false, autoRefreshToken: false } });
  return { servidor, sb, url };
}

export async function levantarModelos(): Promise<{ servidor: ServidorModelos; url: string }> {
  const servidor = modelosFalsos.crearModelos() as ServidorModelos;
  return { servidor, url: await escuchar(servidor) };
}

type Paso = { falla: ClaseError } | { texto?: string; llamadas?: { nombre: string; argumentos: unknown }[]; fallaDespues?: ClaseError };

/** Proveedor guionado, sin red: cada llamada a generar() consume un paso. */
export function proveedorFalso(id: string, pasos: Paso[]): ProveedorLLM & { pedidos: PedidoLLM[] } {
  const cola = [...pasos];
  const pedidos: PedidoLLM[] = [];
  let n = 0;
  return {
    id,
    pedidos,
    modelo: (uso) => `${id}-${uso === "fondo" ? "liviano" : "prueba"}`,
    async *generar(pedido: PedidoLLM): AsyncGenerator<Trozo> {
      // Se copia el historial: el motor lo sigue modificando después.
      pedidos.push({ ...pedido, mensajes: structuredClone(pedido.mensajes) });
      const paso = cola.shift();
      if (!paso) throw new ErrorProveedor(id, "otro", "Guion agotado");
      if ("falla" in paso) throw new ErrorProveedor(id, paso.falla, `Falla de prueba: ${paso.falla}`);
      if (paso.texto) yield { tipo: "texto", texto: paso.texto };
      if (paso.fallaDespues) throw new ErrorProveedor(id, paso.fallaDespues, "Se cortó a mitad de la respuesta");
      for (const l of paso.llamadas ?? []) {
        yield { tipo: "llamada", llamada: { id: `${id}-${n++}`, nombre: l.nombre, argumentos: l.argumentos } };
      }
      yield { tipo: "uso", entrada: 100, salida: 20 };
    },
  };
}

export async function juntar<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const todos: T[] = [];
  for await (const x of g) todos.push(x);
  return todos;
}
