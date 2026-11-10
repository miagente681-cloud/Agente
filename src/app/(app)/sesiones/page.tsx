import type { Metadata } from "next";
import { ListaSesiones } from "./lista";

export const metadata: Metadata = { title: "Sesiones" };

export default function PaginaSesiones() {
  return <ListaSesiones />;
}
