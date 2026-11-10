"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type PerfilCliente = {
  user_id: string;
  name: string | null;
  timezone: string;
  agent_config: Record<string, unknown>;
  onboarding_done: boolean;
};

/** El perfil y la configuración del Agente (un objeto JSON en `profiles.agent_config`). */
export function usePerfil() {
  const [perfil, setPerfil] = useState<PerfilCliente | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await supabaseBrowser()
        .from("profiles")
        .select("user_id,name,timezone,agent_config,onboarding_done")
        .maybeSingle();
      if (vigente && data) setPerfil(data as PerfilCliente);
    })();
    return () => {
      vigente = false;
    };
  }, []);

  /** Mezcla los cambios con la configuración actual y guarda. Devuelve si salió bien. */
  const guardarConfig = useCallback(
    async (cambios: Record<string, unknown>): Promise<boolean> => {
      if (!perfil) return false;
      const agent_config = { ...perfil.agent_config, ...cambios };
      setPerfil({ ...perfil, agent_config });
      const { error } = await supabaseBrowser().from("profiles").update({ agent_config }).eq("user_id", perfil.user_id);
      return !error;
    },
    [perfil],
  );

  return { perfil, guardarConfig };
}
