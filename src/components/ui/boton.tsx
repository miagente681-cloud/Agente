import type { ButtonHTMLAttributes } from "react";

type Variante = "primario" | "secundario" | "fantasma" | "peligro";
type Tamano = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors " +
  "disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap";

const variantes: Record<Variante, string> = {
  primario: "bg-acento text-sobre-acento hover:bg-acento-fuerte",
  secundario: "bg-elevado text-texto border border-borde hover:border-borde-fuerte",
  fantasma: "text-texto-2 hover:text-texto hover:bg-elevado",
  peligro: "bg-peligro-suave text-peligro border border-peligro/30 hover:bg-peligro/25",
};

const tamanos: Record<Tamano, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm", // 44px: cómodo para el dedo
};

export function Boton({
  variante = "secundario",
  tamano = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamano?: Tamano }) {
  return (
    <button
      type={type}
      className={`${base} ${variantes[variante]} ${tamanos[tamano]} ${className}`}
      {...props}
    />
  );
}
