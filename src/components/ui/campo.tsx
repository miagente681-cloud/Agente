import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const estiloBase =
  "w-full rounded-md border border-borde bg-elevado px-3 text-[15px] text-texto " +
  "placeholder:text-texto-3 hover:border-borde-fuerte focus:border-acento focus:outline-none " +
  "disabled:opacity-60";
const estiloCampo = `h-10 ${estiloBase}`;

/** Etiqueta + control + ayuda o error. La etiqueta siempre es visible. */
export function Campo({
  etiqueta,
  ayuda,
  error,
  htmlFor,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  error?: string | null;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-texto-2">
        {etiqueta}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-peligro">
          {error}
        </p>
      ) : ayuda ? (
        <p className="text-[13px] text-texto-3">{ayuda}</p>
      ) : null}
    </div>
  );
}

export function Entrada({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${estiloCampo} ${className}`} {...props} />;
}

export function Selector({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${estiloCampo} ${className}`} {...props} />;
}

export function AreaTexto({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`${estiloBase} min-h-20 resize-y py-2 leading-normal ${className}`}
      {...props}
    />
  );
}
