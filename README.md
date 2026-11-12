# MiAgente

Project manager para la vida personal: un panel donde documentás proyectos y tareas, y un Agente que te llama, conoce tus proyectos y te hace avanzar.

Estado: **en producción.** Cómo está armada y dónde tocar cada cosa: [ARQUITECTURA.md](ARQUITECTURA.md). Variables de entorno: [CREDENCIALES.md](CREDENCIALES.md). Por qué se hizo cada cosa: [DECISIONES.md](DECISIONES.md).

Qué hay:

- **Panel**: áreas, proyectos, tareas y subtareas en cuatro vistas (Hoy / Esta semana, Tablero, Calendario, Ficha de proyecto), con filtro, alta en una línea, paleta de comandos y atajos.
- **Agente por chat**: actualiza el panel con herramientas; cada cambio se ve como tarjeta y se puede deshacer. Claude (pago, con tope mensual) como cerebro principal, con Gemini, Groq y un modelo local de respaldo.
- **Memoria**: entrevista inicial, aprendizaje al cerrar cada sesión y la pantalla «Lo que sé de vos».
- **Voz**: llamadas del Agente y chat de voz cuando quieras, con Azure Speech o la voz del navegador, con interrupciones y contador de uso. Siempre se puede escribir: el Agente responde hablando.
- **Llamadas programadas**: rutinas, disponibilidad, notificaciones push y reprogramación automática.
- **Tus datos**: exportar y borrar todo desde Configuración.

Ninguna función rompe la app si le falta su clave: `/configurar` lista cada integración como configurada o pendiente.

## Puesta en marcha

### 1. Supabase

1. Creá un proyecto gratuito en supabase.com.
2. En **SQL Editor**, pegá y ejecutá, en orden, los archivos de `supabase/migrations/`.
3. En **Authentication → URL Configuration**:
   - *Site URL*: la dirección de la app (por ejemplo `https://miagente.vercel.app`).
   - *Redirect URLs*: agregá `https://TU-DOMINIO/auth/confirmar` y `http://localhost:3000/auth/confirmar`.
4. **Correo con código (requiere SMTP propio).** En el plan gratuito, Supabase no deja cambiar la plantilla del correo mientras se use su servicio de envío integrado: el correo trae solo el enlace. Para que también traiga el código (necesario para entrar desde la app instalada en iPhone), configurá un SMTP gratuito en **Authentication → Emails → SMTP Settings** y después usá este cuerpo en las plantillas **Magic Link** y **Confirm signup**:

   ```html
   <h2>Tu acceso a MiAgente</h2>
   <p>Tu código es: <strong>{{ .Token }}</strong></p>
   <p>O entrá con este enlace:
     <a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email">Ingresar</a>
   </p>
   ```

5. En **Project Settings → API** copiá la URL del proyecto, la clave pública y la clave de servicio.

El envío integrado de Supabase permite 2 correos por hora. Con SMTP propio ese límite deja de aplicar.

### 2. Variables de entorno

Copiá `.env.example` a `.env.local`. Con las tres de Supabase la app ya arranca; el resto se explica en `CREDENCIALES.md`. Ninguna clave va en el código; al navegador solo llegan las que empiezan con `NEXT_PUBLIC_`.

### 3. Correr en tu computadora

```bash
npm install
```

```bash
npm run dev
```

### 4. Desplegar en Vercel

Importá el repositorio en Vercel (plan Hobby), cargá las mismas variables en **Settings → Environment Variables** y desplegá.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación de producción |
| `npm test` | Pruebas unitarias |
| `npm run recorrida` | Pruebas de punta a punta en navegador, con servicios de mentira |
| `npm run lint` | Linter |
| `npm run typecheck` | Chequeo de tipos |

## Pruebas

```bash
npm test
```

Pruebas unitarias: esquema y RLS en un Postgres en memoria, fechas, herramientas y motor del Agente, los tres adaptadores de modelo, control de la llamada y programador (zonas horarias, cambio de día, reprogramación).

```bash
npm run recorrida
```

Recorre la app en Chromium (escritorio y celular) contra servidores de mentira, una segunda vez sin ninguna clave y una tercera con Claude (un Claude de mentira que habla el protocolo de Anthropic y simula el caché). Necesita Playwright instalado en la máquina. Compila con variables de prueba: antes de desplegar a mano, volvé a compilar con las reales.

## Video promocional

`promo/` arma un video vertical (1080×1920, unos 35 segundos) con capturas reales de la app y textos en pantalla. Necesita Playwright y ffmpeg, y el mismo build que la recorrida.

```bash
node promo/capturar.cjs
```

```bash
node promo/render.cjs
```

El resultado queda en `promo/salida/miagente-promo.mp4`. Los textos y los tiempos se cambian en `promo/video.html`.

Para sumarle locución se usa Piper, un motor de voz libre que corre en la máquina (sin servicios externos). Se genera un audio por escena y el video se arma con cada escena durando lo que dura su frase:

```bash
pip install piper-tts
```

```bash
PIPER_MODELO=/ruta/a/la-voz.onnx node promo/locucion.cjs
```

```bash
node promo/render.cjs
```

Con los audios en `promo/locucion/`, el resultado es `promo/salida/miagente-promo-con-voz.mp4`. Las frases están en `promo/locucion.cjs`.

Los tres guiones aceptan un nombre para armar otra versión con sus propios datos, textos y frases. Hoy existe `guzman` (un video en joda): `node promo/capturar.cjs guzman`, `node promo/locucion.cjs guzman` y `node promo/render.cjs guzman`.

## Uso rápido del panel

- **Alta en una línea**: escribí la tarea y Enter. Si terminás con `hoy`, `mañana`, un día (`vie`), una fecha (`14/11`) o una prioridad (`p1` a `p4`), se leen solas: `Pintar el cuarto vie p1`.
- **Tablero**: arrastrá las tarjetas entre columnas o dentro de una. Con teclado: Espacio para levantar, flechas para mover, Espacio para soltar.
- **Calendario**: en escritorio, arrastrá una tarea a otro día para cambiarle la fecha.
- **Filtro** por área y proyecto: vale para Hoy, Tablero y Calendario, y se recuerda en el dispositivo.
- **Atajos**: `Ctrl K` busca o va a cualquier parte, `n` crea una tarea, `g` más una letra cambia de sección, `?` los muestra todos.

## Estructura

```
src/app/(app)/          Pantallas con sesión: hoy, tablero, calendario, proyectos, chat, llamada,
                        sesiones, memoria, bienvenida, configuración
src/app/api/            agent/turn (SSE), sesiones/[id]/cerrar, voice/token, voice/uso,
                        cron/tick, push/probar, cuenta/borrar, estado
src/app/configurar/     Estado de las integraciones
src/lib/agente/         Motor del Agente: proveedores, herramientas, contexto, cierre, deshacer
src/lib/agente/claude/  Claude: precios, modelo de cada uso, presupuesto mensual
src/lib/voz/            Proveedores de voz (Azure, navegador), control de la llamada, cupo
src/lib/programacion/   Lógica de horarios (pura) y el programador
src/lib/push/           Notificaciones push (navegador y servidor)
src/lib/datos/          Datos del panel en memoria; fechas, orden y alta en una línea
src/lib/integraciones.ts Qué variables de entorno están cargadas
src/components/         Navegación, paleta, tareas, tarjetas de cambio, sistema de diseño
public/sw.js            Service worker (sin conexión y push)
supabase/migrations/    Esquema con RLS, función de uso de voz y trabajo del cron
supabase/plantillas/    Correo de ingreso con código
tests/                  Pruebas unitarias; tests/recorrida, las de navegador y los servidores de mentira
```
