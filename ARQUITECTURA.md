# MiAgente: cómo funciona y dónde tocar

Este documento es el mapa del proyecto. Está pensado para que alguien (una persona u otra sesión de Claude Code) que no vio cómo se construyó pueda entender la app y hacer un cambio sin romper nada. Los otros documentos lo complementan:

| Documento | Para qué |
|---|---|
| `ARQUITECTURA.md` (este) | Cómo está armada la app y dónde vive cada cosa |
| `DECISIONES.md` | Por qué se hizo cada cosa así (historial de decisiones, por fecha) |
| `CREDENCIALES.md` | Variables de entorno, cómo se cargan y ajustes del panel de Supabase |
| `README.md` | Presentación breve: para qué sirve y cómo se usa |
| `.env.example` | Lista completa de variables, sin valores |

Última actualización: 20/11/2026.

---

## 1. Qué es

Un gestor de proyectos personal (PWA) con un Agente de IA que conoce los proyectos de la persona, aplica cambios por ella y la llama o le avisa para que avance.

- **Panel:** áreas → proyectos → tareas → subtareas, en cuatro vistas (Hoy, Tablero, Calendario, Proyectos).
- **Agente:** chat escrito, chat de voz y llamadas programadas. Cambia el panel con herramientas; cada cambio se puede deshacer.
- **Informes:** mediciones, gráficos y listas de tareas que se le piden al Agente; se ven en la app y se bajan en PDF.
- **Memoria:** lo que el Agente aprende de la persona, visible y editable en «Lo que sé de vos».
- **Avisos:** llamadas programadas y recordatorios por notificación push.

Es multiusuario: cada persona ve solo lo suyo. Todos comparten las claves del despliegue (Claude, Gemini, Groq, Azure), por eso hay topes y límites del lado del servidor.

## 2. Tecnología y servicios

| Pieza | Qué se usa |
|---|---|
| App | Next.js 16 (App Router), React 19, Tailwind 4, TypeScript, zod 4 |
| Aspecto | Sistema de diseño propio («Punto» con serif): tema oscuro y claro, color principal a elección, tipografías Instrument Serif e Inter servidas por la app (ver sección 8 ter) |
| Base e ingreso | Supabase: Postgres con RLS, Auth (contraseña o código por correo), pg_cron + pg_net + Vault |
| Hosting | Vercel (plan Hobby), proyecto `miagente`. Producción sale de la rama `claude/pensive-galileo-w7i9nk` |
| Modelos | Claude (pago, con tope) → Gemini → Groq → Ollama (opcional). Orden configurable por persona |
| Voz | Llamada en vivo con la API en vivo de Gemini (audio continuo). De respaldo, por turnos: Azure Speech (opcional) o la Web Speech API del navegador |
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
      hoy/ tablero/ calendario/ proyectos/   Vistas del panel (en Hoy, cada día de la tira se toca: hoy/dia.tsx y lib/datos/dia.ts)
      chat/                 Chat escrito con el Agente
      llamada/[id]/         Pantalla de llamada o chat de voz
      bienvenida/           Entrevista inicial
      informes/             Lista de informes y, en [id]/, cada informe con su botón de PDF
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
    informes/               Informes: medidas y bloques, cálculo, geometría de gráficos, PDF (ver sección 8 bis)
    voz/                    Llamada por turnos, Azure, voz del navegador, cupo, desbloqueo de audio en iPhone
      vivo/                 Llamada en vivo: protocolo, audio, conexión, control y lado del servidor (ver sección 7)
    programacion/           horarios.ts (lógica pura) y tick.ts (lo que corre cada minuto)
    push/                   Suscripción (navegador), envío (servidor), lista de destinos válidos
    tema/                   Aspecto: tema oscuro o claro y color principal (ver sección 8 ter)
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
| `areas`, `projects`, `tasks` | El panel. `tasks.parent_id` = subtarea (un nivel). `tasks.plan_fecha` y `plan_hora`: cuándo la persona la va a hacer (aparte de la fecha límite `due_date`); `plan_avisado_para`: para qué instante ya se avisó | La persona y el Agente; el programador marca `plan_avisado_para` |
| `project_log` | Bitácora de cada proyecto | La persona y el Agente |
| `memories` | Lo que el Agente sabe de la persona | El Agente y la persona |
| `sessions` | Cada conversación: `kind` (chat, onboarding, llamada_programada), `channel` (voz, texto), estado, resumen, compromisos | Ver nota abajo |
| `messages` | Mensajes de cada sesión, con herramientas pedidas y resultados | El servidor (con la sesión de la persona) |
| `change_log` | Cada cambio del Agente, con el valor anterior, para deshacer | El servidor |
| `call_routines`, `availability_windows` | Rutinas de llamada y franjas de disponibilidad | La persona |
| `reminders` | Recordatorios push: hora, días, texto | La persona; el programador marca `last_sent_on` |
| `informes` | Informes ya calculados: título, período, `datos` (bloques con sus números) y `analisis` (lectura del Agente) | El Agente (herramienta `armar_informe`); la persona los borra |
| `push_subscriptions` | Dispositivos con notificaciones activadas, y el resultado del último aviso (`ultimo_envio_at`, `ultimo_resultado`, `ultimo_detalle`) | La persona (solo destinos de push reales); el servidor anota cada envío |
| `llm_usage` | Cada pedido a Claude con su costo | **Solo el servidor** (clave de servicio). La persona solo lee |
| `voice_usage` | Uso mensual de Azure | **Solo el servidor** |
| `limites_frecuencia` | Contadores del límite de frecuencia | **Solo el servidor** |

**Reglas de la base que hay que conocer** (migración `0005_seguridad.sql`):

- **Columnas de `sessions` que solo escribe el servidor:** `providers_used`, `context_snapshot`, `context_snapshot_at`, `history_summary`, `history_summary_until`. Con la sesión de un usuario tampoco se puede crear una `llamada_programada` ni cambiar `kind`. Lo impone el disparador `sessions_proteger`.
- **Referencias del mismo dueño:** todas las claves foráneas entre tablas son compuestas `(id, user_id)`. Una fila no puede apuntar a algo de otra persona.
- **Máximos por persona:** 10 suscripciones push, 20 rutinas, 50 ventanas, 10 recordatorios, 200 informes.
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

`src/lib/voz/` y la pantalla `app/(app)/llamada/[id]/llamada.tsx`. Hay dos motores y una sola pantalla: los dos cumplen la interfaz `Control` (`llamada.ts`) y muestran el mismo `EstadoLlamada`.

### Llamada en vivo (`voz/vivo/`)

Es la que se usa cuando hay clave de Gemini. Audio continuo en los dos sentidos con la API en vivo de Gemini (Live API): el micrófono viaja todo el tiempo y la respuesta llega como audio. Quién habla lo decide el servicio escuchando: si la persona habla encima, avisa (`interrupted`) y la pantalla calla el parlante en el acto. No usa la voz ni el dictado del sistema, que en iPhone no conviven con el micrófono de la página (ver `DECISIONES.md`).

**Durante una llamada en vivo el cerebro es el modelo en vivo de Gemini**, no Claude ni el modelo de texto. Las herramientas, el registro de cambios, «Deshacer» y el cierre de la sesión son los de siempre.

- **Camino:** la pantalla pide `POST /api/voice/vivo` → el servidor arma las instrucciones (`sistemaVivo`: las de voz, las propias de la llamada en vivo, la foto del estado y lo último hablado), las herramientas y la voz, y le pide a Google un token de un solo uso con todo eso fijado → el navegador abre el WebSocket directo con Google (Vercel no puede sostener un WebSocket) → manda audio y recibe audio. La clave de Gemini no sale del servidor.
- `protocolo.ts` (lógica pura): los mensajes de ida y de vuelta, el PCM y la bajada del micrófono a 16 kHz. Sin SDK.
- `servidor.ts`: ajustes de la sesión (`ajustesVivo`), token (`pedirTokenVivo`) e instrucciones. El modelo se cambia con `GEMINI_MODEL_VIVO`.
- `llamada.ts` → `LlamadaEnVivo`: el control. Recibe el parlante, la conexión y las funciones que hablan con el servidor, así que se prueba con todo de mentira (`tests/vivo.test.ts`).
- `audio.ts`: la captura del micrófono (AudioWorklet en `public/audio/captura.js`; si el navegador no lo carga, el procesador clásico) y el `Parlante` (cola de trozos, `cortar()`). `conexion.ts`: el WebSocket.
- **Guardar y aplicar:** lo hablado no pasa por el servidor. Al final de cada intercambio la pantalla manda a `POST /api/voice/vivo/turno` lo que el servicio transcribió de cada lado, y ahí mismo se ejecutan las herramientas que pide el Agente (`ejecutarHerramienta`, con la sesión de la persona). Así la transcripción, el resumen y las memorias funcionan igual que en el chat.
- **Renovación:** el servicio corta cada conexión a los pocos minutos y avisa antes (`goAway`). La pantalla abre otra cuando el Agente termina de hablar; el servidor le pasa lo último conversado para que siga sin volver a saludar.
- **Respaldo:** si no arranca, o se cae y no vuelve en tres intentos, la pantalla sigue por turnos sin cortar la llamada. La persona puede elegir «por turnos» en Configuración → Voz (queda en el dispositivo), y ahí también elige la voz.
- **Diagnóstico:** como la conexión es entre el navegador y Google, la pantalla avisa lo que pasa a `POST /api/voice/vivo/aviso` (se conectó y cómo captura el micrófono, se cortó y con qué código, pasó a turnos). Queda en los registros del servidor como `[vivo]`.

### Por turnos (el motor original, ahora el respaldo)

- `llamada.ts` → `ControlLlamada`: la máquina de estados (escuchando → pensando → hablando). No sabe de React ni de Azure.
- `tipos.ts` → `ProveedorVoz`: la interfaz. Dos implementaciones: `azure.ts` y `navegador.ts`.
- `oraciones.ts`: corta el texto que llega en streaming en frases para decirlas a medida que llegan.
- `deteccion.ts` → `DetectorDeVoz`: decide, mirando solo el volumen del micrófono, que la persona empezó a hablar encima del Agente (para interrumpirlo sin tocar nada). Lógica pura: tolera las caídas entre sílabas, mide cuánto del propio Agente entra por el micrófono para no cortarse solo, y tiene sensibilidad regulable (se guarda en el dispositivo). **En iPhone con la voz del navegador no llega a funcionar** (por eso existe la llamada en vivo).
- `volumen.ts` → `crearMonitor()`: mide ese volumen con el contexto de audio de la página (el que se habilita con cada toque). Devuelve `null` cuando no puede medir (audio suspendido, micrófono silenciado por el sistema): la pantalla lo avisa y deja el botón «Interrumpir».
- Azure: el navegador pide un token corto a `/api/voice/token`. El cupo mensual es global para el despliegue y cada token descuenta un mínimo.

### Común a los dos

- `desbloqueo.ts`: en iPhone el audio solo se habilita dentro de un toque. Hay que llamar a `desbloquearAudio()` de forma sincrónica en el manejador del toque, antes de cualquier `await`. El contexto de audio es uno solo para toda la página (`contextoDeAudio()`).
- La pantalla mide cada 40 ms (`llamada.tsx` → `medir()`), mueve el aro que muestra que el micrófono oye y, si el sistema cortó el micrófono, lo vuelve a pedir. Mientras dura la llamada pide que la pantalla del teléfono no se apague.

## 8. Programador: llamadas y recordatorios

- **Quién lo dispara:** `pg_cron` en Supabase corre `public.miagente_tick()` cada minuto. Esa función lee la dirección de la app y el secreto desde Vault y hace un POST a `/api/cron/tick` con `Authorization: Bearer <CRON_SECRET>`.
- **Qué hace:** `programacion/tick.ts` → `correrTick()`, con la clave de servicio:
  1. Cierra llamadas abandonadas.
  2. Manda los recordatorios que tocan (una vez por día cada uno).
  3. Avisa las tareas cuya hora planificada llegó («es la hora»), una vez por instante, salvo que la persona lo haya apagado (`agent_config.avisar_tareas = false`). La decisión es pura: `horarios.ts` → `tareasPorAvisar()`.
  4. Para cada persona, aplica lo que decide `horarios.ts` → `decidir()`: crear la llamada del día, notificarla, reprogramarla si no atendió o darla por perdida.
- **La lógica de horarios es pura** (`horarios.ts`): recibe la hora y los datos, devuelve acciones. Todo en la zona horaria del perfil. Se prueba sin reloj ni base.
- **Push:** `push/servidor.ts` envía con 5 s de máximo por envío; cada corrida tiene 20 s en total para envíos. Solo se envía a hosts de servicios de push reales (`push/destinos.ts`, y la misma lista está en una restricción de la base: si se cambia una, cambiar la otra).
- **Las llamadas solo se avisan por push** (no hay teléfono, correo ni Telegram; ver `DECISIONES.md`). Cada envío queda anotado en el dispositivo con `tick.ts` → `anotarEnvio()`: entregado, o el código y motivo del fallo. Configuración → Notificaciones lo muestra, y Hoy avisa si las llamadas no van a llegar (`components/estado-llamadas.tsx`).
- **Al tocar la notificación** (`public/sw.js`): con la app cerrada la abre en la llamada; abierta, la trae al frente y cambia de página, o le pide a la app que lo haga (`components/registrar-sw.tsx`) si el navegador no deja hacerlo desde el service worker.

Para ver si el programador anda: `select status_code, content from net._http_response order by created desc limit 5;` (200 = bien, 401 = el secreto no coincide, 503 = falta una variable en Vercel).

Para ver si los avisos llegan: `select device_label, ultimo_envio_at, ultimo_resultado, ultimo_detalle from push_subscriptions;`. Un `403 BadJwtToken` de Apple suele indicar claves VAPID cambiadas o un `VAPID_SUBJECT` que no es `https://…` ni `mailto:…`.

## 8 bis. Informes

Todo en `src/lib/informes/`. La regla: **los números los calcula la app, nunca el modelo.**

1. La persona le pide un informe al Agente. El modelo llama a `armar_informe` con título, período y bloques escritos como texto corto («barras hechas,creadas por semana»).
2. `bloques.ts` lee y valida cada bloque (si está mal, devuelve una explicación para que el modelo corrija).
3. `calcular.ts` → `calcularInforme()` hace las cuentas: función pura que recibe las tareas y devuelve los bloques con sus números. Ahí está definido qué cuenta cada medida.
4. `lectura.ts`: el modelo liviano escribe un párrafo a partir de los números (opcional; con tiempo máximo).
5. Se guarda en la tabla `informes` ya calculado, y queda en el registro de cambios (tarjeta «Ver informe» en el chat; deshacer lo borra).
6. La pantalla (`app/(app)/informes/[id]`) valida la forma de lo guardado (`tipos.ts` → `DatosInforme`) y lo dibuja con `components/informes/`.
7. `escena.ts` calcula la geometría de cada gráfico una sola vez; la dibujan el SVG de la pantalla (`grafico.tsx`) y el PDF (`pdf.ts`, con `pdf-lib`, en el navegador). Los colores están en `colores.ts` y están validados: no cambiarlos a ojo.

## 8 ter. Aspecto: temas, color y tipografías

El diseño se llama «Punto» con serif (lo eligió la persona entre maquetas el 25/11/2026): mosaicos redondeados sin borde, separadores punteados, botones en píldora, títulos y números en serif.

- **Todo sale de `src/app/globals.css`.** Ahí están los colores de los dos temas, los radios, las tipografías y las clases propias (`titulo-pagina`, `cifra`, `rotulo`, `enlace`, `trama-puntos`). Los componentes usan esos nombres con Tailwind (`bg-panel`, `text-texto-2`, `rounded-xl`): **no se escriben colores sueltos en los componentes**.
- **Tema:** `<html data-tema="oscuro|claro|sistema">`. Los valores de `@theme` son los del oscuro; el claro los pisa. El claro está dos veces en el CSS (elegido a mano, y «sistema» con el dispositivo en claro) porque CSS no deja juntar las dos condiciones; `tests/tema.test.ts` comprueba que las dos copias sean iguales y que todos los textos se lean sobre todas las superficies (4,5:1).
- **Color principal:** lo elige la persona en Configuración → Aspecto, entre los de `ACENTOS` (`src/lib/tema/acento.ts`) o cualquier otro. De entrada no hay color: lo destacado va en el color del texto. Hay dos nombres y no son intercambiables:
  - `acento` (con `sobre-acento` encima): para **rellenos**. Es el color tal cual.
  - `acento-texto`: para **texto, íconos y bordes** sobre los fondos. Es el mismo color aclarado u oscurecido lo justo para leerse en cada tema (`derivarAcento()`); un amarillo sobre blanco no se lee.
- **Dónde se guarda:** en dos cookies del dispositivo (`miagente-tema`, `miagente-acento`). El layout raíz (`src/app/layout.tsx`) las lee y arma `<html>` ya con el tema y las variables del color, así la página no parpadea con el aspecto anterior al abrir. En el navegador, `src/lib/tema/cliente.ts` (`aplicarTema`, `aplicarAcento`) cambia `<html>` al instante y reescribe la cookie. No protege nada: es solo cómo se ve.
- **Cambiar de tema:** el botón redondo del encabezado de cada pantalla (`components/tema/boton-tema.tsx`, dentro de `EncabezadoPagina`) y la tarjeta Aspecto de Configuración.
- **Enlaces:** van subrayados (clase `enlace`), porque sin color principal se verían igual que el texto.
- **Tipografías:** archivos propios en `src/app/fuentes/` con `next/font/local` (no hay pedidos a Google). Instrument Serif para títulos y números (`font-serif`, clases `titulo-pagina` y `cifra`), Inter para el resto, Geist Mono para lo monoespaciado.
- **Gráficos de los informes:** en pantalla usan variables de CSS (`--grafico-*`) con los dos juegos de colores ya validados (`TEMA_PANTALLA` para el oscuro, `TEMA_PAPEL` para el claro y el PDF).
- **iPhone con la app instalada:** la hora y la batería se dibujan en blanco encima de la página. La clase `franja-estado` deja una franja negra detrás para que se lean también con el tema claro.

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
| `POST /api/voice/vivo` | Llamada en vivo: token de un solo uso de Gemini con las instrucciones y las herramientas fijadas |
| `POST /api/voice/vivo/turno` | Llamada en vivo: guarda lo hablado y ejecuta las herramientas que pide el Agente |
| `POST /api/voice/vivo/aviso` | Llamada en vivo: deja en los registros lo que pasó con la conexión (diagnóstico) |
| `POST /api/push/probar` | Notificación de prueba |
| `POST /api/push/llamada-prueba` | Crea una llamada para ahora y la avisa por push (para probar todo el circuito en el teléfono) |
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

La llamada en vivo se prueba en ese navegador con un micrófono de mentira (el del propio Chromium) y un servicio de voz de mentira que habla el protocolo real por WebSocket (`modelos-falsos.cjs`): la prueba le dicta qué mandar (`POST /__vivo`) y mira qué recibió.

**Lo que las pruebas no cubren:** los modelos reales, Azure real, la llamada en vivo en un teléfono (micrófono, parlante y eco de verdad), una notificación push real en un teléfono y el correo de ingreso. Eso se prueba a mano en producción.

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
| Agregar una medida a los informes | `lib/informes/tipos.ts` (`MEDIDAS`, `INFO_MEDIDA`, con su color) y `calcular.ts` (`deMedida` o `valor`, y la forma de su lista); sumarla a la descripción de `armar_informe` en `herramientas.ts` (cuidando el tope de 7.000 caracteres) y probarla en `tests/informes.test.ts` |
| Agregar un tipo de bloque o un grupo a los informes | `lib/informes/tipos.ts` y `bloques.ts` (lectura y reglas), `calcular.ts`, y si se dibuja, `escena.ts` (lo toman solos la pantalla y el PDF) |
| Cambiar cómo se ve un gráfico o el PDF | Gráficos: `lib/informes/escena.ts` (vale para los dos). Solo pantalla: `components/informes/`. Solo PDF: `lib/informes/pdf.ts`. Mirar el resultado: `GUARDAR_PDF=/ruta/informe.pdf npx vitest run tests/informes-pdf.test.ts` |
| Cambiar cómo se lee una tarea escrita en una línea (fecha, hora, prioridad) | `lib/datos/parsear-tarea.ts` (y sus pruebas en `tests/datos.test.ts`) |
| Cambiar qué se ve al tocar un día de la tira de Hoy | `app/(app)/hoy/dia.tsx` (pantalla) y `lib/datos/dia.ts` (qué tareas y llamadas caen ese día, con pruebas en `tests/datos.test.ts`) |
| Agregar un endpoint | `app/api/.../route.ts`: validar con `usuarioActual()`, y si gasta, `frenarSiHaceFalta()` con una clave nueva en `seguridad/frecuencia.ts` |
| Sumar una integración con clave | Variable en `.env.example` y `CREDENCIALES.md`, entrada en `lib/integraciones.ts`, y que la función degrade si falta |
| Cambiar cuándo se interrumpe al Agente al hablarle encima | `lib/voz/deteccion.ts` (umbrales, ventana, eco) y sus pruebas en `tests/deteccion.test.ts`. No se puede probar sin un micrófono real: después, probar en el teléfono |
| Cambiar un color, un radio o una tipografía de toda la app | `src/app/globals.css`. Después correr `npm test`: `tests/tema.test.ts` avisa si un texto deja de leerse o si las dos copias del tema claro quedaron distintas |
| Sumar un color principal a los que se ofrecen | La lista `ACENTOS` en `src/lib/tema/acento.ts` |
| Usar el color principal en un componente | Relleno: `bg-acento text-sobre-acento`. Texto, ícono o borde: `text-acento-texto` / `border-acento-texto`. Nunca `text-acento` |
| Cambiar la voz | En vivo: la lista está en `lib/voz/vivo/tipos.ts` y se manda en `servidor.ts` → `ajustesVivo()`. Por turnos: `lib/voz/` (`azure.ts` o `navegador.ts`); la lista está en `tipos.ts` |
| Cambiar el modelo o las instrucciones de la llamada en vivo | Modelo: variable `GEMINI_MODEL_VIVO`. Instrucciones y ajustes: `lib/voz/vivo/servidor.ts`. El formato de los mensajes: `protocolo.ts` |
| Cambiar cómo reacciona la llamada en vivo (interrupción, reconexión, guardado) | `lib/voz/vivo/llamada.ts` y sus pruebas en `tests/vivo.test.ts`. Después, probar en el teléfono y mirar los registros `[vivo]` |

## 13. Despliegue y operación

- **Desplegar:** un `git push` a `claude/pensive-galileo-w7i9nk` despliega producción en Vercel. No hay entorno de pruebas separado: todo push va a la app en uso. La rama `main` existe pero está atrasada.
- **Variables:** una variable nueva o cambiada en Vercel recién se aplica al volver a desplegar.
- **Migraciones:** se aplican a mano en Supabase (SQL Editor o la API de administración), en orden. Hasta hoy están aplicadas de la 0001 a la 0009.
- **Registros:** Vercel (plan Hobby) guarda solo la última hora. El servidor escribe líneas `[agente]` cuando un proveedor falla, `[claude]` por cada pedido (tokens y costo, sin datos de la persona) `[push]` cuando un aviso no se pudo entregar y `[vivo]` con lo que pasa en cada llamada en vivo (conexión, cortes, paso a turnos; sin nada de lo conversado).
- **Costo:** todo es gratuito salvo Claude. No activar facturación en ningún otro proveedor.

## 14. Estado y pendientes (25/11/2026)

Funciona en producción: panel, ingreso con contraseña, chat con Gemini y Groq, chat de voz con la voz del navegador (también en iPhone), programador corriendo cada minuto, claves de push cargadas. La llamada en vivo quedó habilitada el 20/11 y comprobada contra el servicio real desde el servidor (conexión, voz, herramientas e interrupción; detalle en `DECISIONES.md`).

Sin confirmar con servicios reales:

- **La llamada en vivo en un teléfono:** micrófono, parlante y eco de verdad. Lo que pase queda en los registros `[vivo]` (Vercel guarda la última hora).
- **El aspecto nuevo en un iPhone** (25/11): se revisó con capturas de un navegador de escritorio, en ancho de computadora y de celular, en los dos temas. Falta verlo en el teléfono, sobre todo la franja de arriba con la app instalada y el tema claro.

- Claude en producción (la lista de correos permitidos se cargó; falta que la persona pruebe «Probar conexión»).
- Una notificación push real en un teléfono, recordatorios incluidos. Desde el 17/11 se puede comprobar con «Recibir una llamada de prueba» en Configuración, y el resultado de cada envío queda en `push_subscriptions`.
- Azure Speech (no está configurado).
- Correo de ingreso con código: requiere SMTP propio en Supabase; la plantilla está en `supabase/plantillas/`.

Ideas anotadas, sin hacer: seguimiento de compromisos entre sesiones, tareas recurrentes, resumen de la mañana, Google Calendar, pasar producción a `main` y tener un entorno de pruebas. Descartado: avisar las llamadas por teléfono, correo o Telegram (la persona eligió solo push).

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
