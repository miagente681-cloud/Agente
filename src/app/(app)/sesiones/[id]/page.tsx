import type { Metadata } from "next";
import { DetalleSesion } from "./detalle";

export const metadata: Metadata = { title: "Sesión" };

export default async function PaginaSesion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetalleSesion id={id} />;
}
