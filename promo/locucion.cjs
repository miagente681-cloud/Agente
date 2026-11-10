/**
 * Locución del video con Piper: un motor de voz libre que corre en la máquina
 * (sin servicios externos ni costo). Genera un audio por escena.
 *
 *   pip install piper-tts
 *   PIPER_MODELO=/ruta/a/la-voz.onnx node promo/locucion.cjs
 *
 * PIPER_PYTHON es el Python donde está instalado piper-tts (por defecto, python3).
 * Las voces en español están en https://github.com/rhasspy/piper (VOICES.md).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

// Una frase por escena del video, en el mismo orden que en su HTML.
//   node promo/locucion.cjs           → promo/video.html
//   node promo/locucion.cjs guzman    → promo/video-guzman.html
const GUIONES = {
  "": [
    "Mi Agente. Tus proyectos, y un agente que no te deja postergarlos.",
    "En Hoy ves lo que toca ahora, con lo vencido arriba.",
    "En el tablero, movés las tareas con un dedo.",
    "Le contás qué hiciste, y él actualiza todo por vos.",
    "Te llama a la hora que elegiste, y repasan juntos tus pendientes.",
    "Aprende cómo trabajás, y qué te frena.",
    "Mi Agente. Menos postergar, más terminar.",
  ],
  guzman: [
    "Atención, Guzmán. Este es un aviso de utilidad pública. Tenemos que hablar de tus tareas.",
    "Empezar el lunes. Venció en septiembre. Desde entonces pasaron siete lunes, Guzmán. Siete.",
    "Este es tu tablero. La columna de tareas hechas está vacía. No es un error de la aplicación. Sos vos.",
    "Le dijiste al agente: mañana arranco, posta. El agente tiene memoria, Guzmán. Y no te cree.",
    "Lo que el agente ya aprendió de vos: postergás hasta lo que te gusta. Dejá de ser tan gil.",
    "Te está llamando. Atendé. Encará. Y andá a conseguir más keke.",
    "Mi Agente. Menos gil, más keke. Dale, Guzmán.",
  ],
};
const NOMBRE = process.argv[2] ?? "";
const GUION = GUIONES[NOMBRE];
if (!GUION) {
  console.error(`No hay guion «${NOMBRE}». Opciones: ${Object.keys(GUIONES).map((k) => k || "(sin nombre)").join(", ")}`);
  process.exit(1);
}

const modelo = process.env.PIPER_MODELO;
if (!modelo) {
  console.error("Falta PIPER_MODELO: la ruta al archivo .onnx de la voz.");
  process.exit(1);
}
const python = process.env.PIPER_PYTHON || "python3";
// Menos de 1 habla más rápido; más de 1, más lento.
const ritmo = process.env.PIPER_RITMO || "1";
const salida = path.join(__dirname, NOMBRE ? `locucion-${NOMBRE}` : "locucion");
fs.mkdirSync(salida, { recursive: true });

GUION.forEach((frase, i) => {
  const archivo = path.join(salida, `${String(i + 1).padStart(2, "0")}.wav`);
  const r = spawnSync(python, ["-m", "piper", "-m", modelo, "-f", archivo, "--length-scale", ritmo], { input: frase, encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
  console.log("  ✓", path.basename(archivo), frase);
});
