import type { Metadata } from "next";
import { ListaInformes } from "./lista";

export const metadata: Metadata = { title: "Informes" };

export default function PaginaInformes() {
  return <ListaInformes />;
}
