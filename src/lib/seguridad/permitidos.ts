/**
 * Quién puede usar Claude (y ver el detalle de las integraciones): los correos
 * de CLAUDE_USUARIOS_PERMITIDOS, separados por coma. Se comparan en minúsculas
 * contra el correo del JWT ya verificado. Vacía: nadie.
 */
export function correosPermitidos(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.CLAUDE_USUARIOS_PERMITIDOS ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function puedeUsarClaude(correo: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!correo) return false;
  return correosPermitidos(env).has(correo.trim().toLowerCase());
}

/** Por ahora quien administra el despliegue es quien puede usar Claude. */
export const esAdministrador = puedeUsarClaude;
