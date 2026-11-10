import type { Metadata } from "next";
import { Llamada } from "./llamada";

export const metadata: Metadata = { title: "Llamada" };

export default async function PaginaLlamada({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Llamada id={id} />;
}
