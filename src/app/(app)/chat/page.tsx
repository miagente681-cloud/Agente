import type { Metadata } from "next";
import { Suspense } from "react";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "Agente" };

export default function PaginaChat() {
  return (
    // useSearchParams necesita un límite de Suspense.
    <Suspense>
      <Chat />
    </Suspense>
  );
}
