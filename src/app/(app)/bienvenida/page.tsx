import type { Metadata } from "next";
import { Bienvenida } from "./bienvenida";

export const metadata: Metadata = { title: "Bienvenida" };

export default function PaginaBienvenida() {
  return <Bienvenida />;
}
