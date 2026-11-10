import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPagina } from "@/components/ui/varios";
import { ConfigAgente } from "./agente";
import { Cuenta } from "./cuenta";

export const metadata: Metadata = { title: "Configuración" };

const MAS = [
  { href: "/calendario", nombre: "Calendario" },
  { href: "/sesiones", nombre: "Sesiones" },
  { href: "/memoria", nombre: "Lo que sé de vos" },
  { href: "/configurar", nombre: "Estado de las integraciones" },
];

export default function Configuracion() {
  return (
    <>
      <EncabezadoPagina titulo="Configuración" descripcion="Tu perfil, el Agente y tus datos." />
      <div className="flex max-w-xl flex-col gap-5">
        {/* En el celular la barra de abajo tiene cinco lugares: el resto se abre desde acá. */}
        <nav aria-label="Más secciones" className="flex flex-wrap gap-2">
          {MAS.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="inline-flex h-9 items-center rounded-md border border-borde bg-panel px-3 text-[13px] font-medium text-texto-2 hover:border-borde-fuerte hover:text-texto"
            >
              {m.nombre}
            </Link>
          ))}
        </nav>
        <Cuenta />
        <ConfigAgente />
      </div>
    </>
  );
}
