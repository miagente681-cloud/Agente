import type { Metadata } from "next";
import { VistaHoy } from "./vista";

export const metadata: Metadata = { title: "Hoy" };

export default function Hoy() {
  return <VistaHoy />;
}
