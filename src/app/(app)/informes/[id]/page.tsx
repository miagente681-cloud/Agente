import type { Metadata } from "next";
import { VistaInforme } from "./informe";

export const metadata: Metadata = { title: "Informe" };

export default async function PaginaInforme({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VistaInforme id={id} />;
}
