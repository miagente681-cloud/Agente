import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { proximaDeRutinas, cuantoFalta } from "@/lib/datos/proxima-llamada";
import { TEMA_PANTALLA, TEMA_PAPEL } from "@/lib/informes/colores";
import {
  ACENTOS,
  contraste,
  derivarAcento,
  leerAcento,
  leerTema,
  MINIMO_TEXTO,
  SUPERFICIE_CRITICA,
  variablesDeAcento,
} from "@/lib/tema/acento";

/**
 * El aspecto de la app: que los dos temas se lean bien, que cualquier color
 * principal que elija la persona se pueda leer, y que las dos copias del tema
 * claro en globals.css no se desfasen.
 */

const css = readFileSync(path.resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");

/** Las variables de color de un bloque de CSS: { "--color-fondo": "#000000", … } */
function variables(bloque: string): Record<string, string> {
  return Object.fromEntries([...bloque.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function bloque(desde: string): string {
  const inicio = css.indexOf(desde);
  expect(inicio, `no está «${desde}» en globals.css`).toBeGreaterThan(-1);
  const abre = css.indexOf("{", inicio);
  return css.slice(abre + 1, css.indexOf("}", abre));
}

const oscuro = { ...variables(bloque("@theme {")), ...variables(bloque("\n:root {")) };
const claro = { ...oscuro, ...variables(bloque(':root[data-tema="claro"] {')) };
const claroDelSistema = { ...oscuro, ...variables(bloque(':root[data-tema="sistema"] {')) };

/** Texto que tiene que leerse sobre cada superficie. */
const TEXTOS = ["--color-texto", "--color-texto-2", "--color-texto-3", "--color-peligro", "--color-ok", "--color-aviso", "--color-info"];
const SUPERFICIES = ["--color-fondo", "--color-panel", "--color-elevado"];

describe("temas", () => {
  it.each([
    ["oscuro", oscuro],
    ["claro", claro],
  ])("en el tema %s, todos los textos se leen sobre todas las superficies", (_nombre, tema) => {
    for (const texto of TEXTOS) {
      for (const superficie of SUPERFICIES) {
        expect(contraste(tema[texto], tema[superficie]), `${texto} sobre ${superficie}`).toBeGreaterThanOrEqual(MINIMO_TEXTO);
      }
    }
  });

  it("el tema claro vale igual elegido a mano que siguiendo al sistema", () => {
    expect(claroDelSistema).toEqual(claro);
  });

  it("las superficies críticas para el color principal son las de globals.css", () => {
    expect(SUPERFICIE_CRITICA.oscuro).toBe(oscuro["--color-elevado"]);
    expect(SUPERFICIE_CRITICA.claro).toBe(claro["--color-fondo"]);
  });

  it("sin color elegido, lo destacado va en el color del texto de cada tema (no en ámbar)", () => {
    expect(oscuro["--color-acento"]).toBe(`var(--acento-o, ${oscuro["--color-texto"]})`);
    expect(oscuro["--color-sobre-acento"]).toBe(`var(--sobre-acento-o, ${oscuro["--color-fondo"]})`);
    expect(claro["--color-acento"]).toBe(`var(--acento-c, ${claro["--color-texto"]})`);
    expect(claro["--color-acento-texto"]).toBe(`var(--acento-texto-c, ${claro["--color-texto"]})`);
    expect(variablesDeAcento(null)).toEqual({});
    expect(ACENTOS[0]).toEqual({ nombre: "Sin color", color: null });
  });

  it("los gráficos usan en cada tema los colores validados", () => {
    for (const serie of ["serie1", "serie2", "serie3"] as const) {
      expect(oscuro[`--grafico-${serie}`]).toBe(TEMA_PANTALLA[serie]);
      expect(claro[`--grafico-${serie}`]).toBe(TEMA_PAPEL[serie]);
    }
    expect(TEMA_PANTALLA.superficie).toBe(oscuro["--color-panel"]);
  });
});

describe("color principal elegido por la persona", () => {
  const dificiles = ["#ffff00", "#ffffff", "#000000", "#0a0a40", "#808080", "#ffb000", "#00ff66", "#ff00ff"];
  const todos = [...ACENTOS.flatMap((a) => (a.color ? [a.color] : [])), ...dificiles];

  it.each(todos)("%s se lee como texto en los dos temas y con texto encima como relleno", (color) => {
    const a = derivarAcento(color);
    // Como texto, sobre cualquier superficie de cada tema.
    for (const superficie of SUPERFICIES) {
      expect(contraste(a.texto.oscuro, oscuro[superficie]), `oscuro, ${superficie}`).toBeGreaterThanOrEqual(MINIMO_TEXTO);
      expect(contraste(a.texto.claro, claro[superficie]), `claro, ${superficie}`).toBeGreaterThanOrEqual(MINIMO_TEXTO);
    }
    // Como relleno: el color tal cual, con negro o blanco encima.
    expect(a.relleno).toBe(color);
    expect(contraste(a.sobre, a.relleno)).toBeGreaterThanOrEqual(MINIMO_TEXTO);
  });

  it("un color que ya se lee no se toca; uno que no, se aclara u oscurece lo justo", () => {
    expect(derivarAcento("#ffb000").texto.oscuro).toBe("#ffb000");
    const amarilloEnClaro = derivarAcento("#ffff00").texto.claro;
    expect(amarilloEnClaro).not.toBe("#ffff00");
    expect(contraste(amarilloEnClaro, "#ffffff")).toBeGreaterThanOrEqual(MINIMO_TEXTO);
    expect(derivarAcento("#0a0a40").texto.claro).toBe("#0a0a40");
  });

  it("deja en <html> las variables de los dos temas", () => {
    const v = variablesDeAcento("#3d6bff");
    expect(v["--acento-o"]).toBe("#3d6bff");
    expect(v["--acento-c"]).toBe("#3d6bff");
    expect(Object.keys(v)).toHaveLength(8);
    // Encima del relleno va negro o blanco, lo que más contraste dé.
    expect(variablesDeAcento("#ffb000")["--sobre-acento-o"]).toBe("#000000");
    expect(variablesDeAcento("#1a2f8a")["--sobre-acento-c"]).toBe("#ffffff");
    // Todas las que lee globals.css están.
    for (const nombre of Object.keys(v)) expect(css).toContain(`var(${nombre},`);
  });

  it("solo acepta colores bien escritos: lo demás es «sin color»", () => {
    expect(leerAcento("#3D6BFF")).toBe("#3d6bff");
    expect(leerAcento("3d6bff")).toBe("#3d6bff");
    expect(leerAcento("red")).toBeNull();
    expect(leerAcento("#fff")).toBeNull();
    expect(leerAcento("#3d6bff; background: url(x)")).toBeNull();
    expect(leerAcento(undefined)).toBeNull();
    expect(leerTema("claro")).toBe("claro");
    expect(leerTema("sistema")).toBe("sistema");
    expect(leerTema("fucsia")).toBe("oscuro");
    expect(leerTema(undefined)).toBe("oscuro");
  });
});

describe("próxima llamada según las rutinas", () => {
  const rutina = (weekdays: number[], local_time: string, focus: string | null = null, active = true) => ({ weekdays, local_time, focus, active });
  // El 24/11/2026 es martes (2).
  const HOY = "2026-11-24";

  it("la de hoy si todavía no pasó; si pasó, la del próximo día que toque", () => {
    const diaria = [rutina([1, 2, 3, 4, 5], "19:00:00", "Repaso del día")];
    expect(proximaDeRutinas(diaria, HOY, "14:10")).toEqual({ fecha: HOY, hora: "19:00", foco: "Repaso del día" });
    expect(proximaDeRutinas(diaria, HOY, "19:00")).toEqual({ fecha: "2026-11-25", hora: "19:00", foco: "Repaso del día" });
  });

  it("elige la más temprana entre varias y saltea las pausadas", () => {
    const varias = [rutina([2], "21:00"), rutina([2], "08:30", "Arranque"), rutina([2], "07:00", null, false)];
    expect(proximaDeRutinas(varias, HOY, "06:00")).toMatchObject({ fecha: HOY, hora: "08:30", foco: "Arranque" });
    expect(proximaDeRutinas(varias, HOY, "09:00")).toMatchObject({ fecha: HOY, hora: "21:00" });
  });

  it("busca hasta una semana adelante; sin rutinas activas no hay próxima", () => {
    expect(proximaDeRutinas([rutina([2], "08:00")], HOY, "09:00")).toMatchObject({ fecha: "2026-12-01", hora: "08:00" });
    expect(proximaDeRutinas([rutina([0], "10:00")], HOY, "09:00")).toMatchObject({ fecha: "2026-11-29" });
    expect(proximaDeRutinas([rutina([2], "08:00", null, false)], HOY, "06:00")).toBeNull();
    expect(proximaDeRutinas([], HOY, "06:00")).toBeNull();
  });

  it("dice cuánto falta en palabras", () => {
    expect(cuantoFalta(0)).toBe("ahora");
    expect(cuantoFalta(25)).toBe("en 25 min");
    expect(cuantoFalta(130)).toBe("en 2 h");
    expect(cuantoFalta(24 * 60)).toBeNull();
  });
});
