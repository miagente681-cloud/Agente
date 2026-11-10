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

Esta fase se hizo antes de tener la especificación original. Al recibirla se comparó punto por punto y se completó lo que faltaba (ver «Ajustes a las fases 1 y 2» más abajo).

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
- **Recorrida en navegador sin Playwright en `package.json`**: el guion usa el Playwright de la máquina. Se agregará como dependencia cuando haya pruebas de punta a punta en la integración continua.
- **Librería nueva:** dnd-kit (`@dnd-kit/core` y `@dnd-kit/sortable`), prevista en el plan.

## Ajustes a las fases 1 y 2 tras leer la especificación

- **Quién puso la fecha límite** se ve ahora en cada tarea de cada lista: una chispa ámbar marca las fechas que sugirió el Agente (antes solo se veía al abrir la tarea).
- **Ícono de área**: un emoji que se escribe en «Áreas». Es lo más simple que cumple sin sumar un selector de íconos.
- **El Calendario muestra también las fechas límite de los proyectos** (en azul) **y las llamadas** (en verde), además de las tareas.
- **«Línea de tiempo»**: se resolvió con el calendario mensual; no hay una vista aparte tipo Gantt.

## Verificaciones antes de las fases 3 a 7 (noviembre de 2026)

La red de la sesión sigue sin dejar abrir las páginas oficiales: se verificó con búsquedas (extractos de documentación oficial cuando los hubo) y con el registro de npm. Lo que cambió el diseño:

| Tema | Resultado | Qué se hizo |
|---|---|---|
| Gemini 3.x y herramientas | Cada llamada trae un `id` y una `thoughtSignature` que hay que devolver tal cual, o el pedido siguiente falla. | El adaptador las conserva en el historial y en la base. Se usa `parametersJsonSchema` (JSON Schema estándar). |
| Cupo gratuito de Gemini | No hay cifra oficial; reportes hablan de muy pocos pedidos por día en los Flash. | Groq deja de ser un respaldo ocasional: se recomienda cargar los dos. Un proveedor que devuelve 429 queda en pausa 2 minutos. |
| Nombres de modelos de Gemini | No se pudo confirmar la lista vigente en fuente oficial. | Son variables de entorno, con `gemini-3.6-flash` y `gemini-3.5-flash-lite` por defecto. |
| Groq | `openai/gpt-oss-120b` vigente; 8.000 tokens por minuto (dato de terceros). | Contexto compacto con ids de 8 caracteres; las 13 herramientas juntas pesan menos de 7.000 caracteres (hay una prueba que lo vigila). |
| Ollama | Su capa compatible con OpenAI tiene reportes de llamadas a herramientas perdidas con streaming. | Se usa su API nativa (`/api/chat`): son tres adaptadores, como estaba planeado. |
| Azure Speech F0 | Confirmado: 5 h de escucha, 500.000 caracteres, 1 reconocimiento a la vez, 20 síntesis por minuto, token de 10 minutos. | Sin cambios de diseño. Los cupos quedaron además como variables, por si cambian. |
| Supabase | pg_cron, pg_net y Vault disponibles en el plan gratuito (comprobado en el proyecto real). | La URL y el secreto del cron van en Vault. |
| Pausa de Supabase por inactividad | No se pudo confirmar que el cron por minuto la evite. | Queda como riesgo conocido; si se pausa, se reactiva desde el panel de Supabase. |
| `web-push` | La versión 4.0.0 salió hace cuatro días. | Se fijó la 3.6.7, la estable de siempre. |
| Plantillas de correo de Supabase | Bloqueadas en el plan gratuito sin SMTP propio (lo confirmó la API al intentarlo). | La plantilla con el código queda lista en `supabase/plantillas/` para cuando esté Brevo. |

## Fase 3 — Agente por chat

- **Ids cortos para el modelo.** En el contexto los ids van recortados a 8 caracteres; un UUID entero gasta unos 20 tokens. El servidor los resuelve contra los datos del usuario.
- **El contexto de cada turno**: personalidad y reglas, fecha y hora, hasta 25 memorias, proyectos activos con su conteo, las 40 tareas abiertas más urgentes (vencidas, bloqueadas, en curso, próximas), las tres últimas sesiones con sus compromisos y las próximas llamadas. El detalle se pide con herramientas.
- **Una tarea «lleva mucho en curso»** cuando pasa 7 días sin cambiar de estado.
- **Historial largo**: se envían como mucho los últimos 40 mensajes; al pasar de 24 mensajes, lo viejo se resume con el modelo liviano y deja de enviarse.
- **Herramientas (13)**: ver proyecto, ver tarea, buscar tareas, crear / actualizar / archivar tarea, crear / actualizar proyecto, crear área, anotar en bitácora, guardar memoria, reprogramar llamada y actualizar rutina. No hay ninguna que borre.
- **Para quitar una fecha el modelo manda «ninguna»** en lugar de un valor nulo: los esquemas quedan más simples y los aceptan todos los proveedores.
- **Se valida todo antes de aplicar nada.** Si en una respuesta viene una llamada mal formada, no se ejecuta ninguna de ese mensaje; así el reintento no duplica cambios. A la primera se le muestra el error al modelo; a la segunda se pasa al siguiente proveedor con el historial limpio.
- **Un id que no existe no cuenta como argumento inválido**: se le devuelve el error al modelo para que busque la tarea, sin cambiar de proveedor.
- **Tope de 6 idas y vueltas con el modelo por turno.**
- **Si un proveedor se corta a mitad de la respuesta**, el texto parcial se descarta de la pantalla y responde el siguiente.
- **Deshacer**: algo que el Agente creó se archiva (una nota de bitácora se quita); algo que cambió vuelve al valor anterior. Deshacer corre con la sesión del usuario desde el navegador, sin endpoint propio.
- **El chat tiene una sola conversación abierta por vez.** «Terminar» la cierra y muestra el resumen. Una charla sin actividad por 6 horas se cierra sola al volver a entrar.
- **`/configurar` requiere sesión** cuando Supabase está configurado (antes era pública): no hay por qué mostrarle a cualquiera qué integraciones tiene el despliegue.
- **Sin límite de pedidos propio en `/api/agent/turn`**: hoy el freno son los cupos de los proveedores. Si esto pasa a ser un producto, hay que agregarlo.

## Fase 4 — Memoria

- **El aprendizaje corre al terminar la sesión**, en un pedido aparte al modelo liviano que devuelve JSON: resumen, compromisos, memorias y una entrada de bitácora por proyecto tratado.
- **No duplicar**: una memoria con el mismo texto se ignora; si corrige una existente, se actualiza. **Si la editaste vos, no se toca** y lo nuevo queda como memoria aparte.
- **Si el modelo no está disponible, la sesión se cierra igual**, sin resumen, y en su pantalla hay un botón para generarlo después.
- **Borrar una memoria desde «Lo que sé de vos» es definitivo** (lo pide la especificación: «editarlas o borrarlas»). El Agente, en cambio, solo archiva.
- **La entrevista inicial** se puede hacer hablando o por escrito. Una cuenta nueva y sin proyectos entra directo a la bienvenida; se puede saltar.
- **«Memorias relevantes»** son, por ahora, las 25 más recientes. No hay búsqueda semántica: con pocas decenas de memorias no hace falta.

## Fase 5 — Voz

- **Se elige solo**: con Azure configurado y cupo disponible se usa Azure; si no, la voz del navegador. Si el cupo se agota en medio de una llamada, cambia al navegador y avisa.
- **Mientras el Agente piensa o habla no se manda audio a Azure.** La interrupción se detecta por el volumen del micrófono (por encima de un umbral durante 350 ms) y recién ahí se vuelve a escuchar. Hay además un botón «Interrumpir», por si el umbral no alcanza en algún dispositivo.
- **Al interrumpir se pierden las primeras sílabas** de lo que dijiste (el reconocimiento arranca en ese momento). Es el costo de no gastar cupo mientras habla el Agente.
- **Lo que el Agente estaba diciendo cuando lo interrumpiste no queda en la transcripción**; los cambios que ya había aplicado, sí.
- **La respuesta se dice por oraciones**: la primera sola, el resto en bloques de unos 140 caracteres, para no pasar de 20 síntesis por minuto.
- **Conteo de uso**: los caracteres los cuenta el servidor (sabe qué texto respondió); los segundos de escucha los reporta el navegador cada 30 segundos. El aviso salta al 90 % y se corta al 98 %, por el atraso de ese reporte.
- **Voces**: Mateo y Valentina (Uruguay), Tomás y Elena (Argentina). Mateo por defecto.
- **Una llamada atendida que queda abierta más de 3 horas** la cierra el programador.

- **Chat de voz cuando quieras (cambio pedido después de la entrega).** La especificación decía que las llamadas solo las iniciaba el Agente. Ahora el botón «Hablar» del chat abre un chat de voz: sigue la conversación abierta o empieza una nueva. Las llamadas programadas siguen igual.
- **En toda pantalla de voz se puede escribir.** Hay un campo de texto siempre visible y una opción para entrar sin micrófono: la persona escribe y el Agente responde hablando. El micrófono se puede activar después sin cortar. Si se niega el permiso de micrófono, la sesión sigue en ese modo en lugar de fallar.
- **En un chat de voz empieza la persona**; en una llamada programada y en la entrevista inicial abre el Agente.

## Fase 6 — Llamadas programadas

- **Sin franjas de disponibilidad cargadas** se asume de 8:00 a 22:00, todos los días.
- **Una llamada ignorada se reprograma con al menos 30 minutos de espera**, en múltiplos de 5 minutos, y nunca encima de otra llamada.
- **Se busca hueco hasta 7 días adelante**; si no hay, se da por perdida.
- **El máximo de reprogramaciones cuenta sobre la misma llamada** (la cadena original → reprogramada → reprogramada), no sobre el día calendario.
- **Las llamadas del día se crean cuando empieza el día** en tu zona horaria. Una rutina creada con la hora ya pasada no genera una llamada «perdida» para hoy.
- **Cambiar una rutina no toca las llamadas ya creadas**: cada llamada copia la duración y el foco al crearse.
- **«Faltar seguido»** son 2 o más llamadas perdidas de la misma rutina entre las últimas sesiones; el Agente lo menciona y puede cambiar el horario.
- **Sin claves de push** el programador hace todo igual y el aviso se ve solo dentro de la app (se revisa cada 30 segundos).
- **Una notificación de llamada vence a los 10 minutos** si el teléfono está apagado.

## Fase 7 — Pulido

- **Atajos**: Ctrl/⌘ K o `/` abre la paleta; `n` crea una tarea desde cualquier pantalla; `g` más una letra va a una sección; `?` los muestra. No valen mientras se escribe en un campo.
- **Exportar** baja un JSON con todas tus tablas, armado en el navegador.
- **Borrar todos mis datos** pide escribir BORRAR. Con la clave de servicio borra también la cuenta; sin ella borra las filas y deja la cuenta vacía.
- **Pruebas de punta a punta**: `npm run recorrida` recorre la app en Chromium contra servidores de mentira (Supabase, Gemini, Groq, Ollama y el emisor de tokens de Azure, que hablan los protocolos reales) y una segunda vez sin ninguna clave. La voz se prueba con un proveedor de voz de mentira inyectado en la página.
- **Tres variables solo para pruebas** (`GEMINI_BASE_URL`, `GROQ_BASE_URL`, `AZURE_SPEECH_TOKEN_URL`) apuntan los adaptadores a esos servidores. No se cargan en Vercel.

## Despliegue

- **Proyecto de Vercel `miagente`** (equipo MiAgente), enlazado a `miagente681-cloud/Agente`. El repo estaba vacío: el código de la fase 1 se trajo desde `Emontone21/MiAg` con su historial.
- **La rama de producción de Vercel sigue siendo `claude/pensive-galileo-w7i9nk`** porque fue la primera que se subió. `main` ya existe con el mismo código; el cambio de rama de producción queda como paso manual en `CREDENCIALES.md`, para no arriesgar el despliegue en uso.
- **Migraciones 0002 y 0003 aplicadas en el proyecto real** de Supabase (solo agregan columnas, una función, un índice y el trabajo del cron).
