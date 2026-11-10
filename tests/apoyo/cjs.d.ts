declare module "*/supabase-falso.cjs" {
  const m: { crearServidor: () => import("node:http").Server; USUARIO: { id: string }; cookieDeSesion: () => unknown };
  export default m;
}
declare module "*/modelos-falsos.cjs" {
  const m: { crearModelos: () => import("node:http").Server };
  export default m;
}
