import type { Metadata } from "next";
import { ListaProyectos } from "./lista";

export const metadata: Metadata = { title: "Proyectos" };

export default function PaginaProyectos() {
  return <ListaProyectos />;
}
