# Decisiones

Lo que el pedido original no definía y cómo se resolvió. La regla fue elegir la opción más simple que cumple.

## Fase 0 — Verificaciones contra la documentación (noviembre de 2026)

| Tema | Resultado | Consecuencia |
|---|---|---|
| Modelos gratuitos de Gemini | La página de precios muestra gratis Gemini 3.6 Flash y Gemini 3.5 Flash-Lite. No se pudo confirmar que `gemini-3.5-flash` y `gemini-3.1-flash-lite` sigan gratis. | Los nombres de modelo van en variables de entorno (`GEMINI_MODEL_CHAT`, `GEMINI_MODEL_FONDO`). Se confirman en AI Studio antes de la fase 3. |
| Privacidad en Gemini gratis | El contenido se usa para mejorar productos de Google. | Aviso en Configuración (fase 3). |
| Groq gratis, `openai/gpt-oss-120b` | 30 pedidos/min, 1.000/día, 8.000 tokens/min, 200.000 tokens/día. | El contexto de un turno tiene que entrar en unos 3.000 tokens. |
| Azure Speech F0 | 5 h/mes de transcripción, 500.000 caracteres/mes de voz neuronal, 1 reconocimiento simultáneo, 20 síntesis por minuto. | El micrófono no se envía a Azure mientras habla el Agente (la interrupción se detecta en el navegador). La síntesis se agrupa para no pasar de 20 por minuto. |
| Voces `es-UY` | `es-UY-MateoNeural` y `es-UY-ValentinaNeural`. | Mateo por defecto; se cambia en Configuración. |
| Cron de Vercel (Hobby) | Una vez por día. | El minuto a minuto lo hace `pg_cron` de Supabase. |
| Supabase gratis | El proyecto se pausa tras una semana sin actividad. | Pendiente de confirmar en la fase 6 si el cron por minuto cuenta como actividad. |
| Push en iOS | Solo con la app instalada en la pantalla de inicio y permiso pedido desde un toque. | El onboarding guía la instalación. |

Estas verificaciones se hicieron con búsquedas (la red de la sesión de trabajo no permitía abrir las páginas oficiales completas). Se repiten antes de cada fase que dependa de ellas.

## Fase 1 — Base

- **Ingreso con enlace y con código.** El mismo correo trae el enlace mágico y un código numérico. En iPhone el enlace abre Safari y no la app instalada, y la sesión no se comparte entre ambos; el código se escribe dentro de la app y resuelve eso.
- **El código depende de un SMTP propio.** Verificado al configurar el proyecto: en el plan gratuito de Supabase no se puede editar la plantilla del correo con el envío integrado, así que el correo trae solo el enlace. Con un SMTP gratuito configurado, la plantilla incluye el código. El envío integrado además está limitado a 2 correos por hora.
- **Sin Cache Components.** Next.js 16 lo activa en proyectos nuevos; se desactivó. La app es privada y muy interactiva: el panel lee los datos desde el navegador con la sesión del usuario, y no hay contenido público que convenga prerenderizar.
- **El panel habla directo con Supabase.** La barrera de seguridad es RLS en la base. El `proxy.ts` solo refresca la sesión y redirige a quien no la tiene; no es la protección principal.
- **Estados y categorías como texto con `check`**, no como tipos `enum` de Postgres: agregar un valor más adelante es una migración trivial.
- **Prioridad de 1 a 4** (1 = urgente, 4 = baja), por defecto 2.
- **Subtareas de un solo nivel**: una tarea con `parent_id`.
- **Archivar en lugar de borrar**: `tasks`, `areas` y `memories` tienen `archived_at`; los proyectos usan el estado `archivado`. El borrado definitivo es un `delete` real que solo se ofrece en el panel.
- **`status_changed_at` en tareas**, para que el Agente detecte lo que lleva mucho en curso sin moverse. Un disparador mantiene esa fecha, `completed_at` y `blocked_reason` coherentes con el estado, lo cambie el panel o el Agente.
- **El contador de voz es de solo lectura para el usuario**; lo actualiza el servidor con la clave de servicio.
- **El service worker no cachea páginas ni datos de la app**, solo una página de «sin conexión». La información personal no queda en caché del dispositivo.
- **Tipografía Geist servida desde el propio sitio** (paquete `geist`), sin pedidos a Google Fonts.
- **Un solo color de acento: ámbar `#f5a524`.** Rojo y verde se usan únicamente para estado (vencido, hecho).
- **Pruebas del esquema con PGlite**: las migraciones se aplican en un Postgres en memoria y se comprueba que RLS aísla a dos usuarios. El esquema `auth` de Supabase se simula con lo mínimo.

## Fase 2 — Proyectos y tareas

La especificación original no llegó en el traspaso (el punto 12 vino con el texto de relleno), así que esta fase se hizo con la descripción del traspaso y las decisiones ya aprobadas. Si la especificación pide algo distinto, se ajusta.

- **Los datos del panel viven en memoria** (`src/lib/datos/almacen.tsx`): se leen una vez de Supabase y cada cambio se ve al instante y después se guarda. Si la base lo rechaza, se avisa y se vuelve a leer todo, en lugar de deshacer a mano cada caso.
- **Solo los proyectos activos alimentan Hoy, Tablero y Calendario.** Las tareas de proyectos pausados, completados o archivados se ven solo en la ficha del proyecto.
- **«Esta semana» va de lunes a domingo.** Lo vencido se muestra siempre arriba, en rojo.
- **Hoy incluye lo que está en curso** aunque no venza hoy: es «lo que toca ahora».
- **Una tarea cargada desde Hoy o desde un día del Calendario queda con esa fecha.** Desde el Tablero o la ficha queda sin fecha.
- **Alta en una línea: fecha y prioridad solo al final del texto.** Así «Preparar la reunión de mañana con Ana» no pierde palabras. Un día de la semana es siempre el próximo (nunca hoy); una fecha sin año que ya pasó es del año que viene.
- **Nombres de prioridad:** P1 Urgente, P2 Alta, P3 Media, P4 Baja. En las listas solo se marcan P1 y P4, para que lo normal no haga ruido.
- **Tablero:** muestra tareas, no subtareas (la tarjeta trae la cuenta «2/5»). La columna «Hecha» muestra las últimas dos semanas, ordenadas por fecha de cierre. Al mover una tarjeta a «Bloqueada» se abre para anotar qué la traba.
- **Orden manual con números fraccionarios**: mover una tarjeta escribe una sola fila.
- **Arrastrar funciona con mouse, dedo y teclado** en el Tablero. En el Calendario solo con mouse (en el celular las celdas son muy chicas); la fecha siempre se puede cambiar desde el detalle.
- **Completar una tarea no completa sus subtareas** ni al revés. Archivar o borrar una tarea sí se lleva sus subtareas, y mover una tarea de proyecto las mueve con ella.
- **Archivar se puede deshacer** desde el aviso, o más tarde desde «Archivadas» en la ficha del proyecto. Borrar pide confirmación.
- **Archivar un área no toca sus proyectos**: pasan a mostrarse como «Sin área».
- **El filtro por área y proyecto se guarda en el dispositivo** (`localStorage`), no en la base.
- **En el celular el Calendario se abre desde Hoy** (botón «Mes»), porque en la barra de abajo entran cinco secciones.
- **Paleta de comandos y atajos de teclado**: quedan para más adelante; no eran necesarios para las cuatro vistas.
- **Recorrida en navegador sin Playwright en `package.json`**: el guion usa el Playwright de la máquina. Se agregará como dependencia cuando haya pruebas de punta a punta en la integración continua.
- **Librería nueva:** dnd-kit (`@dnd-kit/core` y `@dnd-kit/sortable`), prevista en el plan.

## Despliegue

- **Proyecto de Vercel `miagente`** (equipo MiAgente), enlazado a `miagente681-cloud/Agente`. El repo estaba vacío: el código de la fase 1 se trajo desde `Emontone21/MiAg` con su historial.
- **La rama de producción es `claude/pensive-galileo-w7i9nk`** porque fue la primera que se subió. Conviene crear `main` y pasar la producción ahí cuando se revise este trabajo.
