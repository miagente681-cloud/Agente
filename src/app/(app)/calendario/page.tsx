import type { Metadata } from "next";
import { Calendario } from "./calendario";

export const metadata: Metadata = { title: "Calendario" };

export default function PaginaCalendario() {
  return <Calendario />;
}
