import { AvisoLlamada } from "@/components/aviso-llamada";
import { BarraInferior, BarraLateral } from "@/components/navegacion";
import { Paleta } from "@/components/paleta";
import { DetalleTarea } from "@/components/tareas/detalle-tarea";
import { ProveedorDatos } from "@/lib/datos/almacen";

export default function LayoutApp({ children }: LayoutProps<"/">) {
  return (
    <ProveedorDatos>
      <div className="flex min-h-dvh">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-acento focus:px-3 focus:py-2 focus:text-sobre-acento"
        >
          Saltar al contenido
        </a>
        <BarraLateral />
        <main
          id="contenido"
          className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] md:px-8 md:pb-10 md:pt-8"
        >
          {children}
        </main>
        <BarraInferior />
      </div>
      <DetalleTarea />
      <AvisoLlamada />
      <Paleta />
    </ProveedorDatos>
  );
}
