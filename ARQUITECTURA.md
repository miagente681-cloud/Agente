# MiAgente: cómo funciona y dónde tocar

Este documento es el mapa del proyecto. Está pensado para que alguien (una persona u otra sesión de Claude Code) que no vio cómo se construyó pueda entender la app y hacer un cambio sin romper nada. Los otros documentos lo complementan:

| Documento | Para qué |
|---|---|
| `ARQUITECTURA.md` (este) | Cómo está armada la app y dónde vive cada cosa |
| `DECISIONES.md` | Por qué se hizo cada cosa así (historial de decisiones, por fecha) |
| `CREDENCIALES.md` | Variables de entorno, cómo se cargan y ajustes del panel de Supabase |
| `README.md` | Presentación breve: para qué sirve y cómo se usa |
| `.env.example` | Lista completa de variables, sin valores |

Última actualización: 12/11/2026.

---

## 1. Qué es

Un gestor de proyectos personal (PWA) con un Agente de IA que conoce los proyectos de la persona, aplica cambios por ella y la llama o le avisa para que avance.

- **Panel:** áreas → proyectos → tareas → subtareas, en cuatro vistas (Hoy, Tablero, Calendario, Proyectos).
- **Agente:** chat escrito, chat de voz y llamadas programadas. Cambia el panel con herramientas; cada cambio se puede deshacer.
- **Memoria:** lo que el Agente aprende de la persona, visible y editable en «Lo que sé de vos».
- **Avisos:** llamadas programadas y recordatorios por notificación push.

Es multiusuario: cada persona ve solo lo suyo. Todos comparten las claves del despliegue (Claude, Gemini, Groq, Azure), por eso hay topes y límites del lado del servidor.

## 2. Tecnología y servicios

| Pieza | Qué se usa |
|---|---|
| App | Next.js 16 (App Router), React 19, Tailwind 4, TypeScript, zod 4 |
| Base e ingreso | Supabase: Postgres con RLS, Auth (contraseña o código por correo), pg_cron + pg_net + Vault |
| Hosting | Vercel (plan Hobby), proyecto `miagente`. Producción sale de la rama `claude/pensive-galileo-w7i9nk` |
| Modelos | Claude (pago, con tope) → Gemini → Groq → Ollama (opcional). Orden configurable por persona |
| Voz | Azure Speech (opcional) o la Web Speech API del navegador |
| Push | Web Push con claves VAPID (paquete `web-push`) |
| Pruebas | Vitest + PGlite (Postgres en memoria), Playwright con servicios de mentira |

**Atención con Next.js 16:** tiene cambios respecto de versiones anteriores (por ejemplo, el middleware se llama `src/proxy.ts`). Antes de escribir código de Next, leer la guía que corresponda en `node_modules/next/dist/docs/` (ver `AGENTS.md`).

Direcciones: `https://miagente-zeta.vercel.app` y `https://miagente-mi-agente1.vercel.app`. Supabase: proyecto `mmlvguoaovfurouwnwnk`.

## 3. Mapa de carpetas

```
src/
  proxy.ts                  Corre en cada pedido: CSP con nonce, control de Origin, sesión, redirección a /ingresar
  app/
    layout.tsx              Layout raíz (todas las páginas se arman por pedido, por el nonce de la CSP)
    ingresar/               Pantalla de ingreso (contraseña o código)
    auth/confirmar/         Enlace del correo de ingreso
    configurar/             Estado de las integraciones (solo para quien administra)
    (app)/                  Todo lo que requiere sesión; layout.tsx carga los datos y la navegación
      hoy/ tablero/ calendario/ proyectos/   Vistas del panel
      chat/                 Chat escrito con el Agente
      llamada/[id]/         Pantalla de llamada o chat de voz
      bienvenida/           Entrevista inicial
      memoria/              «Lo que sé de vos»
      sesiones/             Historial y detalle de cada sesión
      configuracion/        Un archivo por tarjeta: agente, claude, voz, llamadas, recordatorios, cuenta, contrasena, datos
    api/                    Endpoints del servidor (ver sección 9)
  components/               Navegación, paleta de comandos, filtro, tarjetas de tarea, piezas de UI
  lib/
    agente/                 El cerebro (ver sección 5)
      proveedores/          Un adaptador por modelo: claude, gemini, openai (Groq), ollama
      claude/               Precios, modelos por uso, presupuesto y tope
    datos/                  Almacén del panel en el navegador, fechas, orden, perfil
    voz/                    Llamada, Azure, voz del navegador, cupo, desbloqueo de audio en iPhone
    programacion/           horarios.ts (lógica pura) y tick.ts (lo que corre cada minuto)
    push/                   Suscripción (navegador), envío (servidor), lista de destinos válidos
    seguridad/              Correos permitidos, límite de frecuencia, cabeceras
    supabase/               Clientes: navegador, servidor (con la sesión) y admin (clave de servicio)
    integraciones.ts        Qué variables tiene cargadas el despliegue (solo sí o no)
public/sw.js                Service worker: página sin conexión y notificaciones push
supabase/migrations/        El esquema, en orden. Nunca se edita una migración ya aplicada: se agrega otra
tests/                      Pruebas unitarias (*.test.ts), apoyo/ y recorrida/ (navegador)
promo/                      Videos promocionales (no forma parte de la app)
```

## 4. Datos

Las migraciones de `supabase/migrations/` son la fuente de verdad. Todas las tablas tienen `user_id` y RLS.

| Tabla | Qué guarda | Quién escribe |
|---|---|---|
| `profiles` | Nombre, zona horaria, `agent_config` (preferencias en JSON), si hizo la entrevista | La persona (y el servidor para marcas) |
| `areas`, `projects`, `tasks` | El panel. `tasks.parent_id` = subtarea (un nivel) | La persona y el Agente |
| `project_log` | Bitácora de cada proyecto | La persona y el Agente |
| `memories` | Lo que el Agente sabe de la persona | El Agente y la persona |
| `sessions` | Cada conversación: `kind` (chat, onboarding, llamada_programada), `channel` (voz, texto), estado, resumen, compromisos | Ver nota abajo |
| `messages` | Mensajes de cada sesión, con herramientas pedidas y resultados | El servidor (con la sesión de la persona) |
| `change_log` | Cada cambio del Agente, con el valor anterior, para deshacer | El servidor |
| `call_routines`, `availability_windows` | Rutinas de llamada y franjas de disponibilidad | La persona |
| `reminders` | Recordatorios push: hora, días, texto | La persona; el programador marca `last_sent_on` |
| `push_subscriptions` | Dispositivos con notificaciones activadas | La persona (solo destinos de push reales) |
| `llm_usage` | Cada pedido a Claude con su costo | **Solo el servidor** (clave de servicio). La persona solo lee |
| `voice_usage` | Uso mensual de Azure | **Solo el servidor** |
| `limites_frecuencia` | Contadores del límite de frecuencia | **Solo el servidor** |

**Reglas de la base que hay que conocer** (migración `0005_seguridad.sql`):

- **Columnas de `sessions` que solo escribe el servidor:** `providers_used`, `context_snapshot`, `context_snapshot_at`, `history_summary`, `history_summary_until`. Con la sesión de un usuario tampoco se puede crear una `llamada_programada` ni cambiar `kind`. Lo impone el disparador `sessions_proteger`.
- **Referencias del mismo dueño:** todas las claves foráneas entre tablas son compuestas `(id, user_id)`. Una fila no puede apuntar a algo de otra persona.
- **Máximos por persona:** 10 suscripciones push, 20 rutinas, 50 ventanas, 10 recordatorios.
- **Largo máximo** en los textos (por ejemplo `messages.content` ≤ 16.000 caracteres).
- **Funciones solo para la clave de servicio:** `gasto_claude_mes`, `gasto_claude_desglose`, `consumir_limite`, `uso_voz_global`, `sumar_uso_voz`.

`profiles.agent_config` guarda, entre otras: `orden_proveedores`, `claude_modelos`, `claude_tope_usd`, `voz`, `margen_minutos`, `max_reprogramaciones`, y marcas internas (`claude_problema`, `claude_aviso_80`, `claude_tope_avisado`). Lo puede escribir la persona desde el navegador: **nunca usarlo para algo que proteja plata o cupos.**

## 5. El Agente

Todo en `src/lib/agente/`.

**Un turno, paso a paso** (`/api/agent/turn` → `runner.ts`):

1. El endpoint valida la sesión, aplica el límite de frecuencia y busca o crea la sesión.
2. `claude/servidor.ts` → `prepararProveedores()` arma la lista de modelos y decide si Claude entra (ver sección 6).
3. `runner.ts` → `correrTurno()`:
   - Lee el estado de la persona (`datos.ts` → `leerInstantanea`).
   - Arma el prompt de sistema con `contexto.ts`: una parte estable (personalidad y reglas), una «foto» del estado congelada al empezar la sesión (para que el caché de Claude sirva) y el resumen del historial.
   - Llama al primer modelo. Si falla (límite, no responde, error), sigue con el siguiente con el mismo historial.
   - Ejecuta las herramientas que pida el modelo (`herramientas.ts`) y vuelve a llamarlo, hasta 6 pasos.
   - Guarda cada mensaje en `messages`.
4. La respuesta sale por SSE: eventos `texto`, `cambio`, `proveedor`, `cambio_proveedor`, `aviso`, `error`, `terminar`, `fin`. El navegador los lee con `cliente.ts` → `pedirTurno()`.

**Herramientas** (`herramientas.ts`): se definen una sola vez con zod en el objeto `HERRAMIENTAS`; de ahí sale el esquema para todos los modelos. Las que cambian datos llaman a `registrar()`, que anota en `change_log` para poder deshacer (`deshacer.ts`). Hay una prueba que limita el tamaño total de las definiciones a 7.000 caracteres (por el cupo de Groq): las descripciones tienen que ser cortas.

**Cierre de sesión** (`cierre.ts`, endpoint `/api/sesiones/[id]/cerrar`): marca la sesión como completada y le pide al modelo liviano el resumen, los compromisos y las memorias nuevas. El Agente puede cerrarla solo con la herramienta `terminar_sesion` cuando la persona se lo pide.

**Proveedores** (`proveedores/`): cada adaptador implementa `ProveedorLLM` (`tipos.ts`) y traduce el formato neutro al de su API. `indice.ts` arma la lista según las variables cargadas y el orden de la persona. Para sumar un modelo: escribir el adaptador y registrarlo en `indice.ts`.

## 6. Claude y la plata

Claude es el único proveedor pago. Las reglas están en `claude/` y en `seguridad/permitidos.ts`:

- **Quién:** solo los correos de `CLAUDE_USUARIOS_PERMITIDOS` (comparados contra el correo del JWT verificado). Esos mismos correos son quienes «administran» y ven `/configurar`.
- **Requisitos:** `ANTHROPIC_API_KEY` y la clave de servicio de Supabase. Si falta algo, el Agente sigue con los gratuitos.
- **Modelo por uso** (`claude/config.ts`): chat y tareas de fondo con Haiku; llamadas programadas y entrevista con Sonnet. La persona lo cambia dentro de una lista cerrada (`claude/precios.ts`).
- **Tope:** `CLAUDE_TOPE_USD_GLOBAL` (10 por defecto) suma a todas las personas en el mes. El tope del perfil solo puede bajar el de esa persona. La suma la hace la base.
- **Sesión en curso:** una sesión que ya usó Claude (según `llm_usage`) puede pasarse hasta un 20 % del tope, para no cortar una llamada.
- **Registro:** cada pedido se guarda en `llm_usage` con su costo estimado (`precios.ts`). Al 80 % avisa una vez.
- **Problemas de clave o crédito:** se marca `claude_problema` y no se reintenta por una hora.

## 7. Voz

`src/lib/voz/` y la pantalla `app/(app)/llamada/[id]/llamada.tsx`.

- `llamada.ts` → `ControlLlamada`: la máquina de estados (escuchando → pensando → hablando). No sabe de React ni de Azure.
- `tipos.ts` → `ProveedorVoz`: la interfaz. Dos implementaciones: `azure.ts` y `navegador.ts`.
- `oraciones.ts`: corta el texto que llega en streaming en frases para decirlas a medida que llegan.
- `desbloqueo.ts`: en iPhone el audio solo se habilita dentro de un toque. Hay que llamar a `desbloquearAudio()` de forma sincrónica en el manejador del toque, antes de cualquier `await`.
- Azure: el navegador pide un token corto a `/api/voice/token`. El cupo mensual es global para el despliegue y cada token descuenta un mínimo.

## 8. Programador: llamadas y recordatorios

- **Quién lo dispara:** `pg_cron` en Supabase corre `public.miagente_tick()` cada minuto. Esa función lee la dirección de la app y el secreto desde Vault y hace un POST a `/api/cron/tick` con `Authorization: Bearer <CRON_SECRET>`.
- **Qué hace:** `programacion/tick.ts` → `correrTick()`, con la clave de servicio:
  1. Cierra llamadas abandonadas.
  2. Manda los recordatorios que tocan (una vez por día cada uno).
  3. Para cada persona, aplica lo que decide `horarios.ts` → `decidir()`: crear la llamada del día, notificarla, reprogramarla si no atendió o darla por perdida.
- **La lógica de horarios es pura** (`horarios.ts`): recibe la hora y los datos, devuelve acciones. Todo en la zona horaria del perfil. Se prueba sin reloj ni base.
- **Push:** `push/servidor.ts` envía con 5 s de máximo por envío; cada corrida tiene 20 s en total para envíos. Solo se envía a hosts de servicios de push reales (`push/destinos.ts`, y la misma lista está en una restricción de la base: si se cambia una, cambiar la otra).

Para ver si el programador anda: `select status_code, content from net._http_response order by created desc limit 5;` (200 = bien, 401 = el secreto no coincide, 503 = falta una variable en Vercel).

## 9. Endpoints

Todos validan la sesión con `usuarioActual()` (JWT verificado). Los que gastan aplican `frenarSiHaceFalta()` (límite por minuto y por día; responde 429).

| Endpoint | Qué hace |
|---|---|
| `POST /api/agent/turn` | Un turno del Agente, por SSE |
| `POST /api/sesiones/[id]/cerrar` | Cierra la sesión y genera resumen, compromisos y memorias |
| `POST /api/claude/probar` | Pedido mínimo para comprobar la clave de Claude |
| `GET /api/claude/gasto` | Gasto del mes para el panel |
| `POST /api/voice/token` | Token corto de Azure Speech |
| `POST /api/voice/uso` | Suma segundos de reconocimiento al cupo |
| `POST /api/push/probar` | Notificación de prueba |
| `GET /api/estado` | Qué funciones tiene el despliegue (el detalle, solo para quien administra) |
| `POST /api/cuenta/borrar` | Borra todos los datos de quien lo pide |
| `POST /api/cron/tick` | El programador. No usa sesión: se protege con `CRON_SECRET` |

## 10. Seguridad: lo que no hay que romper

El principio de toda la app: **nada que proteja plata o cupos puede depender de datos que la persona puede escribir desde el navegador.** Cualquiera con sesión puede hablarle directo a la API de Supabase y saltearse la app.

- **Tres clientes de Supabase** (`lib/supabase/`): `client.ts` (navegador), `server.ts` (servidor, con la sesión de la persona, respeta RLS) y `admin.ts` (clave de servicio, saltea RLS). El admin se usa solo para lo que la persona no puede hacer por sí misma, y cada consulta filtra por `user_id` a mano.
- **Claves:** solo en variables de entorno del servidor. Nunca en el código, nunca con `NEXT_PUBLIC_` (salvo las públicas por diseño), nunca en un mensaje de error o un registro.
- **CSP con nonce** (`proxy.ts` + `seguridad/cabeceras.ts`): si se suma un servicio externo al que el navegador se conecta, hay que agregarlo a `connect-src`. Los scripts en línea propios necesitan el nonce.
- **Origin:** el proxy rechaza los pedidos a `/api/` que modifican algo y no vienen de la propia app.
- **Registro cerrado:** «Allow new users to sign up» está apagado en Supabase y el ingreso por código no crea cuentas (salvo `NEXT_PUBLIC_REGISTRO_ABIERTO=true`).
- **Degradación:** cada integración sin su clave muestra «falta configurar» en lugar de romper. `integraciones.ts` es la lista.

## 11. Pruebas

```bash
npm test
```

Pruebas unitarias (unos segundos). `tests/esquema.test.ts` aplica todas las migraciones en un Postgres en memoria y prueba RLS, disparadores y restricciones con dos usuarios. `tests/seguridad.test.ts` tiene un caso por cada ataque de la auditoría.

```bash
npm run recorrida
```

Compila y recorre la app en un navegador real contra servicios de mentira (`tests/recorrida/supabase-falso.cjs` y `modelos-falsos.cjs`). Son tres recorridos: el completo, sin claves opcionales y con Claude. Tarda unos minutos.

```bash
npm run lint
```

```bash
npm run typecheck
```

Antes de subir un cambio tienen que pasar las cuatro cosas. Los servicios de mentira no validan RLS ni restricciones de la base: si se agrega una tabla o una función de la base, hay que sumarla en `supabase-falso.cjs` y probar las reglas en `esquema.test.ts`.

**Lo que las pruebas no cubren:** los modelos reales, Azure real, una notificación push real en un teléfono y el correo de ingreso. Eso se prueba a mano en producción.

## 12. Recetas: dónde tocar

| Quiero… | Tocar |
|---|---|
| Cambiar cómo habla o qué reglas sigue el Agente | `lib/agente/contexto.ts` (constantes de personalidad y `REGLAS`) |
| Darle una herramienta nueva al Agente | `lib/agente/herramientas.ts` (objeto `HERRAMIENTAS`). Si cambia datos, usar `registrar()`. Descripción corta |
| Agregar un modelo o proveedor | Adaptador en `lib/agente/proveedores/` + `indice.ts`. Para Claude, la lista y los precios están en `claude/precios.ts` |
| Cambiar el tope o los límites | Variables `CLAUDE_TOPE_USD_GLOBAL` y `LIMITE_<CLAVE>` (ver `.env.example`); valores por defecto en `claude/config.ts` y `seguridad/frecuencia.ts` |
| Agregar una pantalla | Carpeta nueva en `app/(app)/` y un enlace en `components/navegacion.tsx` |
| Agregar una tarjeta en Configuración | Archivo nuevo en `app/(app)/configuracion/` y sumarlo en `page.tsx` |
| Agregar una tabla o columna | Migración nueva (`000N_nombre.sql`) con RLS; aplicarla en Supabase; sumarla en `tests/esquema.test.ts`, `supabase-falso.cjs`, la exportación (`configuracion/datos.tsx`) y el borrado (`api/cuenta/borrar`) |
| Cambiar cuándo se llama o se reprograma | `lib/programacion/horarios.ts` (y sus pruebas en `tests/programacion.test.ts`) |
| Cambiar qué dice una notificación | `lib/programacion/tick.ts` (los objetos `CargaPush`) |
| Agregar un endpoint | `app/api/.../route.ts`: validar con `usuarioActual()`, y si gasta, `frenarSiHaceFalta()` con una clave nueva en `seguridad/frecuencia.ts` |
| Sumar una integración con clave | Variable en `.env.example` y `CREDENCIALES.md`, entrada en `lib/integraciones.ts`, y que la función degrade si falta |
| Cambiar la voz | `lib/voz/` (`azure.ts` o `navegador.ts`); la lista de voces está en `tipos.ts` |

## 13. Despliegue y operación

- **Desplegar:** un `git push` a `claude/pensive-galileo-w7i9nk` despliega producción en Vercel. No hay entorno de pruebas separado: todo push va a la app en uso. La rama `main` existe pero está atrasada.
- **Variables:** una variable nueva o cambiada en Vercel recién se aplica al volver a desplegar.
- **Migraciones:** se aplican a mano en Supabase (SQL Editor o la API de administración), en orden. Hasta hoy están aplicadas de la 0001 a la 0006.
- **Registros:** Vercel (plan Hobby) guarda solo la última hora. El servidor escribe líneas `[agente]` cuando un proveedor falla y `[claude]` por cada pedido (tokens y costo, sin datos de la persona).
- **Costo:** todo es gratuito salvo Claude. No activar facturación en ningún otro proveedor.

## 14. Estado y pendientes (12/11/2026)

Funciona en producción: panel, ingreso con contraseña, chat con Gemini y Groq, chat de voz con la voz del navegador (también en iPhone), programador corriendo cada minuto, claves de push cargadas.

Sin confirmar con servicios reales:

- Claude en producción (la lista de correos permitidos se cargó; falta que la persona pruebe «Probar conexión»).
- Una notificación push real en un teléfono, recordatorios incluidos.
- Azure Speech (no está configurado).
- Correo de ingreso con código: requiere SMTP propio en Supabase; la plantilla está en `supabase/plantillas/`.

Ideas anotadas, sin hacer: seguimiento de compromisos entre sesiones, bot de Telegram, tareas recurrentes, resumen de la mañana, Google Calendar, pasar producción a `main` y tener un entorno de pruebas.

## 15. Puesta en marcha desde cero

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

## 16. Video promocional

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
