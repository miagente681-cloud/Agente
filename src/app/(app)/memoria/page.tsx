import type { Metadata } from "next";
import { Memorias } from "./memorias";

export const metadata: Metadata = { title: "Lo que sé de vos" };

export default function PaginaMemoria() {
  return <Memorias />;
}
