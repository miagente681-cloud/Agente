/**
 * Arma el video promocional: abre promo/video.html, pide cada cuadro con
 * render(t) y se los pasa a ffmpeg. Necesita Playwright y ffmpeg en la máquina.
 *
 *   node promo/capturar.cjs   (una vez, para las capturas de la app)
 *   node promo/render.cjs
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const CPS = 30;
const SALIDA = path.join(__dirname, "salida");

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const destino = path.join(SALIDA, "miagente-promo.mp4");
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await pagina.goto("file://" + path.join(__dirname, "video.html"));
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.waitForLoadState("networkidle");
  const duracion = await pagina.evaluate(() => window.DURACION);
  const cuadros = Math.round(duracion * CPS);

  const ffmpeg = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(CPS), "-c:v", "mjpeg", "-i", "-",
    // Pista de audio en silencio: algunas redes rechazan videos sin audio.
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", destino,
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
