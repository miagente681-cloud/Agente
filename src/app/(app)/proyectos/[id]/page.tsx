import type { Metadata } from "next";
import { FichaProyecto } from "./ficha";

export const metadata: Metadata = { title: "Proyecto" };

export default async function PaginaProyecto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FichaProyecto id={id} />;
}
