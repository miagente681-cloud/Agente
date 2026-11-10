/**
 * Arma el video promocional: abre promo/video.html, pide cada cuadro con
 * render(t) y se los pasa a ffmpeg. Necesita Playwright y ffmpeg en la máquina.
 *
 *   node promo/capturar.cjs   (una vez, para las capturas de la app)
 *   node promo/render.cjs
 */
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const CPS = 30;
const SALIDA = path.join(__dirname, "salida");
const LOCUCION = path.join(__dirname, "locucion");
/** La frase empieza un instante después que la escena y deja aire al final. */
const ANTES = 0.45;
const DESPUES = 0.7;

/** Los audios de promo/locucion (si se generaron con locucion.cjs), con su duración. */
function audios() {
  if (!fs.existsSync(LOCUCION)) return [];
  return fs.readdirSync(LOCUCION).filter((f) => f.endsWith(".wav")).sort().map((f) => {
    const archivo = path.join(LOCUCION, f);
    const duracion = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", archivo], { encoding: "utf8" }));
    return { archivo, duracion };
  });
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await pagina.goto("file://" + path.join(__dirname, "video.html"));
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.waitForLoadState("networkidle");
  const voces = audios();
  const base = await pagina.evaluate(() => [...document.querySelectorAll(".escena")].map((e) => Number(e.dataset.d)));
  const conVoz = voces.length === base.length;
  if (voces.length && !conVoz) console.log(`  Hay ${voces.length} audios para ${base.length} escenas: se arma sin locución.`);
  // Cada escena dura al menos lo que su frase.
  const tiempos = base.map((d, i) => (conVoz ? Math.max(d, ANTES + voces[i].duracion + DESPUES) : d));
  const inicios = await pagina.evaluate((t) => window.configurar(t), tiempos);
  const duracion = tiempos.reduce((a, b) => a + b, 0);
  const cuadros = Math.round(duracion * CPS);
  const destino = path.join(SALIDA, conVoz ? "miagente-promo-con-voz.mp4" : "miagente-promo.mp4");

  const entradasAudio = conVoz
    ? voces.flatMap((v) => ["-i", v.archivo])
    // Sin locución, una pista en silencio: algunas redes rechazan videos sin audio.
    : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];
  const mezcla = conVoz
    ? [
        "-filter_complex",
        voces.map((_, i) => `[${i + 1}:a]aresample=44100,adelay=${Math.round((inicios[i] + ANTES) * 1000)}:all=1[a${i}]`).join(";") +
          `;${voces.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voces.length}:normalize=0,loudnorm=I=-16:TP=-1.5,apad[voz]`,
        "-map", "0:v", "-map", "[voz]",
      ]
    : [];
  const ffmpeg = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(CPS), "-c:v", "mjpeg", "-i", "-",
    ...entradasAudio,
    ...mezcla,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-shortest", "-movflags", "+faststart", destino,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const fin = new Promise((ok, mal) => ffmpeg.on("close", (c) => (c === 0 ? ok() : mal(new Error("ffmpeg salió con " + c)))));

  for (let i = 0; i < cuadros; i++) {
    await pagina.evaluate((t) => window.render(t), i / CPS);
    const jpg = await pagina.screenshot({ type: "jpeg", quality: 95 });
    if (!ffmpeg.stdin.write(jpg)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    if (i % 150 === 0) console.log(`  cuadro ${i} de ${cuadros}`);
  }
  ffmpeg.stdin.end();
  await fin;
  await navegador.close();
  console.log(`Listo: ${destino} (${duracion.toFixed(1)} s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
