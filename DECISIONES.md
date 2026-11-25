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

## Claude como cerebro del Agente (pedido el 11/11/2026)

**Cambio respecto de la especificación:** la regla de costo cero se reemplaza solo para Claude, el único proveedor pago autorizado, siempre con tope mensual. Gemini, Groq y Ollama quedan de respaldo.

Verificado en la documentación oficial (platform.claude.com) el 11/11/2026: los identificadores `claude-haiku-5-5`, `claude-sonnet-5-5` y `claude-opus-5-5`; los precios (coinciden con los que pasaste, incluido el tramo de Haiku por encima de 100.000 tokens, que cuenta también lo leído y escrito del caché); el mínimo cacheable de 512 tokens para Haiku 5.5 y Sonnet 5.5; las duraciones de caché de 5 minutos y 1 hora; y la búsqueda hacia atrás de 20 bloques. No hizo falta cambiar ningún modelo.

- **SDK oficial `@anthropic-ai/sdk` (1.8.0)**, API de Messages con streaming y herramientas, detrás de la misma interfaz de proveedor. El SDK manda la clave como `Authorization: Bearer` y la versión de API `2026-10-21` (no se usa ningún parámetro que esa versión quite).
- **Sin reintentos del SDK** (`maxRetries: 0`) y 25 segundos para empezar a responder: si Claude falla, responde el siguiente proveedor enseguida en lugar de hacer esperar.
- **Qué modelo responde se elige por el tipo de sesión**, no por el día ni el canal: todas las llamadas programadas usan el modelo de «Llamadas programadas» (Sonnet por defecto), incluidas las de otros días que no sean lunes ni viernes y las hechas por escrito. Un chat de voz iniciado por vos es chat (Haiku). Si querés que las llamadas diarias cortas usen Haiku, se cambia en Configuración.
- **Lista cerrada de modelos:** Haiku 5.5, Sonnet 5.5 y Opus 5.5. Un valor fuera de la lista vuelve al de por defecto.
- **Razonamiento:** Haiku va sin razonamiento extendido y con esfuerzo bajo (rápido y barato). Sonnet y Opus razonan con esfuerzo medio: es donde importa que el coach piense, aunque en voz agrega un poco de demora antes de hablar. Los bloques de razonamiento se devuelven tal cual dentro del turno y no se guardan: en los turnos siguientes la conversación viaja sin ellos (la API lo admite y así nunca choca con su control de historial editado).
- **Caché de prompts.** La API arma el pedido como herramientas → sistema → mensajes, así que el orden quedó: herramientas, instrucciones y personalidad (punto de caché 1, que también guarda las herramientas), memorias y estado (punto 2), conversación (punto 3, en el último bloque). Tres de los cuatro puntos permitidos.
- **La foto de memorias y estado se congela al empezar la sesión** y se reusa en cada turno; si no, cada cambio en el panel o el paso de un minuto invalidaría el caché. Lo que el Agente cambia durante la sesión lo sabe por la conversación, y para el estado actual tiene `ver_proyecto` y `ver_tarea`. La foto se rehace si la sesión pasa de una hora (un chat retomado más tarde). Esto vale para todos los proveedores.
- **Duración del caché por canal:** 5 minutos en voz (los turnos van seguidos) y 1 hora por escrito (los mensajes están espaciados). Las tareas de fondo no usan caché: son un solo pedido.
- **Cada pedido a Claude se registra** en la tabla `llm_usage` (modelo, uso, tokens de entrada, salida, escritura de caché de 5 min y 1 h, lectura, costo y mes). El costo se calcula una vez, con la tabla de `src/lib/agente/claude/precios.ts`, y se guarda. La tabla se escribe con tu sesión (RLS): no depende de la clave de servicio.
- **El mes se cuenta en tu zona horaria** (`America/Montevideo`).
- **Tope por defecto US$ 10**, configurable. Al 80 %: aviso en la app y notificación push, una vez por mes. Al llegar: Claude deja de usarse y el Agente dice una sola vez «Este mes ya usé todo el presupuesto de Claude; sigo con el modelo gratuito», como parte de su respuesta (también se escucha en voz).
- **Una sesión que empezó con Claude se termina con Claude** aunque se llegue al tope en el medio, incluido su resumen de cierre. **Esto puede pasarse del tope por unos centavos.**
- **Clave inválida o sin crédito:** se marca en tu perfil y Claude no se vuelve a probar por una hora (no en cada mensaje). Configuración lo avisa; «Probar conexión» borra la marca si anda. Se detecta tanto el error de facturación (402) como el 400 que la API devuelve al llegar al límite de gasto de la consola.
- **Una negativa por seguridad** (`stop_reason: "refusal"`) pasa al siguiente proveedor. No se usa el parámetro de respaldo del servidor de Anthropic: el respaldo propio de la app (Gemini, Groq) ya cubre ese caso y mantiene el cálculo de costo simple.
- **Las definiciones de herramientas no usan `eager_input_streaming`:** sus argumentos son cortos y se validan igual con zod antes de aplicarlos.
- **Un orden de proveedores guardado antes de que existiera Claude** lo pone primero.
- **«Probar conexión»** usa Haiku con 16 tokens de salida; también queda registrado (cuesta menos de una milésima de centavo).

## Ingreso con contraseña (pedido el 11/11/2026)

- **La contraseña es la forma habitual de entrar**; el código o enlace por correo queda para la primera vez y para cuando la olvidás. No hay flujo aparte de «recuperar contraseña»: entrás con un código y la cambiás en Configuración. Es más simple y no depende de que el correo traiga un enlace a una página nueva.
- **La contraseña se pone en Configuración → Cuenta**, con la sesión abierta. Se pide repetirla y que tenga al menos 8 caracteres. El mínimo de 8 quedó puesto también en Supabase Auth (antes era 6), así que se cumple del lado del servidor.
- **No se puede crear una cuenta nueva con contraseña** desde la pantalla de ingreso: las cuentas nuevas siguen entrando por código. Así no hace falta confirmar correos aparte.
- **El formulario usa los nombres que reconocen los gestores de contraseñas** (`username`, `current-password`, `new-password`), para que el navegador o el celular la guarden y la completen.

## Auditoría de seguridad (pedido el 11/11/2026)

Principio: nada que proteja plata o cupos depende de datos que la persona puede escribir desde el navegador. Todo lo de la base va en `supabase/migrations/0005_seguridad.sql`, sin tocar las anteriores ni borrar datos.

| Tema | Decisión |
|---|---|
| Columnas de la sesión que maneja el servidor | **Disparador** `sessions_proteger` en lugar de permisos por columna: con los roles `anon` y `authenticated` rechaza crear `llamada_programada`, cambiar `kind` y escribir `providers_used`, `context_snapshot(_at)` y `history_summary(_until)`. Con permisos por columna habría que listar a mano cada columna editable y acordarse al agregar una nueva; el disparador nombra solo las protegidas y da un error claro. El servidor las escribe con la clave de servicio. Se revisó el panel: nunca escribe esas columnas. |
| `onboarding` | Se puede seguir creando desde el navegador (la entrevista inicial la abre el panel). Usa Sonnet, pero queda dentro de los mismos topes y límites de frecuencia. |
| Sin clave de servicio | El Agente no responde (503 «Falta configurar la clave de servicio»): sin ella no se pueden contar los límites ni registrar el gasto. La foto del contexto y el resumen del historial no se guardan; la foto se arma igual en cada turno. Ya estaba cargada en producción. |
| Tope global y del perfil | `CLAUDE_TOPE_USD_GLOBAL` (10 por defecto) suma a todos. El tope del perfil vale `min(perfil, global)`: solo baja. Corta lo que llegue primero. |
| Mes del tope global | Cada fila guarda el mes en la zona horaria de su dueño y la suma global es por ese texto (`2026-11`). Con personas en zonas distintas, en las horas del cambio de mes puede haber un desfase de horas; se aceptó por simple. |
| «La sesión ya usó Claude» | Se mira en `llm_usage` (solo lo escribe el servidor). Margen: 20 % sobre el tope (propio y global); después se corta igual. |
| Si la base no responde la suma | Se actúa como si se hubiera llegado al tope: Claude no se usa. |
| Largo de mensajes | Base: `messages.content` ≤ 16.000 caracteres; `tool_calls` y `tool_result` ≤ 64 KB. Además, límites generosos en los textos que llegan al contexto (títulos, descripciones, memorias, bitácora, perfil). Al armar el pedido cada mensaje se recorta a 6.000 caracteres (resultados de herramientas a 8.000). Todas las restricciones se crearon `not valid` y se validaron después; las filas existentes cumplían. |
| Registro cerrado | `shouldCreateUser: false` salvo `NEXT_PUBLIC_REGISTRO_ABIERTO=true`. Al revisar la configuración real de Supabase el registro **seguía abierto**: lo cerré desde la API de administración (es lo que pidió la persona y se revierte con un clic). |
| Límite de frecuencia | Tabla `limites_frecuencia` sin políticas y función `consumir_limite` (una sola sentencia `insert … on conflict`), solo para la clave de servicio. Ventanas fijas por minuto y por día (UTC). Los pedidos rechazados también cuentan. Valores por defecto (por minuto/por día): turno 20/600, cerrar 10/150, probar Claude 3/20, token de voz 6/60, uso de voz 10/2000, push de prueba 3/20; se cambian con `LIMITE_<CLAVE>`. |
| Destinos push | Lista vigente verificada (lista de pushpad/known-push-services y la documentación de cada servicio): `fcm.googleapis.com` (Chrome, Opera, Brave, Samsung), `updates.push.services.mozilla.com` (Firefox), `*.push.apple.com` (Safari), `*.notify.windows.com` (Edge). Solo `https`, puerto 443, sin usuario. Se controla en el navegador antes de guardar, en la base (`push_endpoint_conocido`) y antes de cada envío. |
| Tiempos de push | 5 s por envío (opción `timeout` de web-push); 20 s de envíos por corrida del programador; los dispositivos de una persona se avisan en paralelo. Lo que no entra se descarta (un aviso viejo no sirve) y se cuenta en `postergados`. |
| Máximos por persona | 10 suscripciones push, 20 rutinas, 50 ventanas de disponibilidad (disparador con candado por usuario). Un upsert de una suscripción existente no cuenta. |
| Cupo de Azure | Global (suma de `voice_usage` del mes, función `uso_voz_global`). Cada token entregado descuenta 60 s de escucha y 1.500 caracteres de voz antes de entregarse (`AZURE_MINIMO_*_POR_TOKEN`). El uso que informa el navegador se suma aparte (puede contar de más, nunca de menos). El panel de Voz muestra el cupo del despliegue solo a quien administra. |
| Política de contenido | Con nonce por pedido desde el proxy y `'strict-dynamic'`; por eso todas las páginas se arman en cada pedido (`connection()` en el layout raíz). `style-src` permite `'unsafe-inline'` porque React escribe atributos `style` y los estilos no ejecutan código. `connect-src`: la propia app, el Supabase del despliegue (https y wss) y Azure Speech (`*.stt.speech.microsoft.com`, `*.tts.speech.microsoft.com`). La página sin conexión tiene su propia política, sin scripts. Se sumó `Strict-Transport-Security` y `Cross-Origin-Opener-Policy`. |
| Origin | Lo controla el proxy para todo `/api/` con un método que modifica algo: el host del encabezado `Origin` tiene que coincidir con el del pedido. Queda afuera `/api/cron/tick` (lo llama Supabase y se protege con su secreto). |
| Quién administra | Los mismos correos de `CLAUDE_USUARIOS_PERMITIDOS`. El resto recibe de `/api/estado` solo lo necesario para que funcione la app (si hay Agente, voz y push, y la clave pública VAPID). |
| Referencias entre tablas | Cada referencia pasó a ser una clave foránea compuesta `(id, user_id)` con `on delete set null (columna)` donde antes era `set null`. Es declarativo y vale también para el servidor. |
| `npm audit` | `npm audit fix` sin `--force` no corregía nada (proponía bajar `eslint-config-next` a la 15). Se resolvió con un `override` de `minimatch` a 11.0.8 solo dentro de `@typescript-eslint/typescript-estree`: 0 vulnerabilidades y el lint pasa igual. |
| Notificaciones en la recorrida | Chromium sin pantalla niega siempre el permiso de notificaciones; la recorrida comprueba que el service worker se registra con la política nueva y que la API de push está disponible. La suscripción real se prueba en un teléfono. |

## Demora de las respuestas (12/11/2026)

En producción, Gemini no empezaba a responder a tiempo en ningún turno («sin_respuesta») y cada mensaje esperaba 25 s antes de pasar a Groq.

| Tema | Decisión |
|---|---|
| Razonamiento de Gemini | Sin indicarlo, Gemini 3 usa el nivel «high». Se pide `thinkingLevel: "low"` (el que la documentación recomienda para chat). Si un modelo no lo acepta (400 que menciona «thinking»), se pide una vez sin él. |
| Espera antes de pasar al siguiente | Primera respuesta: 8 s en voz y 15 s por escrito (antes 25 s), en Gemini y Groq. |
| Proveedor que no respondió | Se saltea por 1 minuto (si hay otro en la lista), como ya se hacía tras un 429. Vale por instancia del servidor. |
| iPhone sin voz | Safari solo habla si el primer `speak()` ocurre dentro de un toque: se destraba el audio de forma sincrónica al tocar, y la voz del navegador tolera que iOS no avise el final de una frase. |

## Terminar la sesión pidiéndoselo al Agente (12/11/2026)

| Tema | Decisión |
|---|---|
| Cómo | Herramienta `terminar_sesion` (sin argumentos). Marca el turno; el servidor manda el evento `terminar` al final y la pantalla cierra igual que con el botón (resumen, compromisos y memorias incluidos). |
| Cuándo se corta | Después de la despedida: en el chat, 1,5 s después de mostrarla; en la llamada, cuando terminó de decirla, sin volver a escuchar. |
| Por su cuenta | No: la descripción y las reglas le dicen que solo la use si la persona lo pide. |
| Tamaño | La descripción es mínima para no pasarse del cupo de tokens por turno de Groq (la prueba de tamaño sigue en 7.000 caracteres). |

## Recordatorios por notificación (12/11/2026)

| Tema | Decisión |
|---|---|
| Qué son | Tabla `reminders` (migración 0006): hora, días de la semana y texto. Se arman en Configuración → Recordatorios. Máximo 10 por persona. |
| Quién los manda | El mismo programador de las llamadas (una vez por minuto), con las mismas claves de push. No dependen de tener rutinas de llamada. |
| Uno por día | Se marca `last_sent_on` antes de enviar, solo si nadie lo marcó: dos corridas no avisan dos veces. Si se cambia la hora o los días, puede volver a sonar ese día. |
| Si el programador estuvo caído | Un recordatorio con más de 60 minutos de atraso ya no se manda. |
| Al tocarlo | Abre el chat con el Agente, que es donde se documenta. |
| Claves | Con autorización explícita de la persona, generé las claves VAPID y el secreto del programador y los cargué en Vercel y en Supabase (Vault). `VAPID_SUBJECT` es la dirección de la app. |

## Las llamadas llegan solo por notificación push (pedido el 17/11/2026)

La persona eligió que las llamadas se avisen únicamente con push en la app instalada (la tiene en el iPhone). Se evaluaron y descartaron: llamar a su número de teléfono (los proveedores de telefonía cobran por número y por minuto, y el audio del teléfono no entra en las funciones de Vercel), un link por correo a una reunión de Meet o Zoom (meter al Agente en esas reuniones requiere bots pagos), el correo como aviso y un bot de Telegram.

Lo que había el 17/11: las 7 fases hechas, el programador corriendo cada minuto y un iPhone suscripto. El 12 y 13/11 se avisaron 6 llamadas y ninguna se atendió; después la persona borró sus rutinas. El programador no guardaba si cada aviso le llegaba al servicio de Apple, así que no había forma de saber si sonaron.

| Tema | Decisión |
|---|---|
| Registro de entrega | Migración 0007: `push_subscriptions` guarda `ultimo_envio_at`, `ultimo_resultado` (`entregado` o `fallo`) y `ultimo_detalle` (código y motivo del servicio de push, por ejemplo `403 BadJwtToken`; nunca la dirección ni las claves). Lo escriben el programador, la notificación de prueba y la llamada de prueba. «Entregado» quiere decir que el servicio de push lo aceptó; que el teléfono lo muestre ya depende de él. |
| Quién puede escribir esas columnas | La persona también (RLS de la tabla): las reinicia al volver a activar las notificaciones. Es solo diagnóstico, no protege plata ni cupos, así que no hace falta un disparador que lo impida. |
| Registro en el servidor | Cada envío fallido deja una línea `[push]` con el servicio (por ejemplo `web.push.apple.com`) y el motivo, sin datos de la persona. |
| Configuración → Notificaciones | Lista los dispositivos con el resultado del último aviso («entregado hace 2 h» o por qué falló) y marca cuál es este. Botones: «Recibir una llamada de prueba» y «Enviar una notificación de prueba». |
| Llamada de prueba | `POST /api/push/llamada-prueba`: el servidor crea una llamada programada para ese minuto (con la clave de servicio, porque la base no deja que la persona cree llamadas) y la avisa por push al instante. Foco «repaso muy breve», 3 minutos. No se reprograma: si no se atiende, se da por perdida. No se crea si ya hay una llamada esperando (lleva a esa). Límite: 1 por minuto y 5 por día (`LIMITE_LLAMADA_PRUEBA`), porque si se atiende usa el modelo de las llamadas. |
| Aviso en Hoy | Si no hay ninguna rutina: «Tu Agente todavía no te llama», con un link a las rutinas (se puede ocultar; queda guardado en el navegador). Si hay rutinas activas y ningún dispositivo con notificaciones, o todos fallaron en el último aviso: aviso destacado con un link a Notificaciones. Con las rutinas pausadas no se avisa nada. |
| Tocar la notificación con la app abierta | El service worker trae la app al frente y cambia de página con `WindowClient.navigate()`. No pude confirmar que Safari en iPhone lo tenga; si no está o falla, le manda un mensaje a la app y la app navega sola a la llamada (`registrar-sw.tsx`). Con la app cerrada, la abre directo en la llamada. |
| El Agente sin rutinas | Si la persona no tiene ninguna rutina, el contexto le dice al Agente que puede proponer armar una en Configuración. No se le dio una herramienta para crearlas: las definiciones de herramientas están en 6.997 de los 7.000 caracteres que permite el cupo de Groq. |

## Día y hora para hacer cada tarea (pedido el 18/11/2026)

La persona pidió poder elegir, por cada tarea, la hora en que la va a hacer. Hasta ahora cada tarea tenía solo la fecha límite, sin hora.

| Tema | Decisión |
|---|---|
| Dato nuevo | Migración 0008: `tasks.plan_fecha` (día) y `tasks.plan_hora` (hora, opcional), de reloj de pared en la zona del perfil, como las rutinas. No puede haber hora sin día (restricción `tasks_plan_hora_con_fecha`). |
| Aparte de la fecha límite | «Para cuándo tiene que estar» y «cuándo la hago» son cosas distintas: una tarea puede vencer el viernes y estar planificada para el miércoles a las 15:00. Por eso no se le agregó hora a `due_date`. |
| Detalle de la tarea | Sección «Cuándo la hacés» con día y hora. Una hora sin día se toma para hoy; borrar el día borra también la hora. |
| Alta en una línea | Lee la hora al final: `15:30`, `15hs`, `9h`, `a las 15`, `a la 1`, `de las 9:15`. Un número solo («Comprar huevos 12») no es hora, salvo después de «a las». Con hora, el día es el de la fecha escrita, el de la vista (Hoy) o hoy. Si también se escribió una fecha («mañana a las 10»), esa fecha queda además como fecha límite, como antes. |
| Hoy | La sección «Hoy» suma lo planificado para hoy (y lo planificado para días anteriores que no se hizo, marcado en amarillo para replanificarlo). Orden: primero eso atrasado, después lo que tiene hora (por hora), después el resto por prioridad. En «Esta semana», cada tarea aparece una sola vez: el día planificado si cae en la semana; si no, el de su fecha límite. |
| Calendario | Cada tarea va el día que la hacés; si no lo elegiste, el de su fecha límite. Arrastrarla mueve esa misma fecha (con su hora). Las que tienen hora la muestran antes del título. |
| Tablero y listas | Marca con un reloj: «15:00» si es hoy, «Mañana 9:30» o «mié 19 15:00». No se muestra en las tareas hechas. |
| Aviso | A la hora planificada, el programador manda una notificación con el título de la tarea («Es la hora: la planificaste para las 15:00»). Al tocarla se abre esa tarea (`/hoy?tarea=<id>`). Una vez por instante (`plan_avisado_para`): si se cambia la hora, se vuelve a avisar a la nueva. No se avisa lo hecho ni lo archivado, ni con más de una hora de atraso. |
| Apagar el aviso | Configuración → Notificaciones → «Avisarme a la hora de cada tarea» (`agent_config.avisar_tareas`, encendido por defecto). Es una preferencia: no protege nada. |
| Agente | `crear_tarea` y `actualizar_tarea` aceptan `hacer` («AAAA-MM-DD» o «AAAA-MM-DD HH:MM»; «ninguna» para quitarlo). El resumen del estado le muestra «la hace mié 19 15:00» y «la iba a hacer» si el día ya pasó. Una regla nueva le dice que para reservar un momento use `hacer` y no la fecha límite. Para que las definiciones sigan bajo 7.000 caracteres (cupo de Groq) se acortaron textos: el de los ids, la descripción de `actualizar_tarea` y la del motivo de bloqueo. |
| Configuración compartida | La tarjeta de Notificaciones recibe el perfil de la de Llamadas en lugar de cargarlo aparte: dos copias del perfil se pisaban los ajustes al guardar. |

## Informes del Agente (pedido el 19/11/2026)

La persona pidió que el Agente pueda armar informes, gráficos y mediciones («un informe en PDF de mis tareas hechas en el mes»). Antes de implementar se le consultó y eligió: verlos en la app con descarga en PDF; flexibles y a pedido (no una lista fija); medir tareas hechas y puntualidad; sin envíos automáticos. Quedaron afuera por su elección: postergaciones y tiempo trabado (habría que guardar historial), tiempo real contra estimado (habría que cronometrar) y llamadas y sesiones.

| Tema | Decisión |
|---|---|
| Quién calcula | La app, nunca el modelo. El Agente solo elige qué bloques lleva el informe; `src/lib/informes/calcular.ts` hace las cuentas (función pura, con pruebas). El modelo recibe los números ya calculados para comentarlos. |
| Cómo lo pide el Agente | Herramienta `armar_informe`: título, período (`desde`, `hasta`), filtro opcional por proyecto o área y hasta 8 bloques. Cada bloque es un texto corto, «tipo medidas [por grupo]» («barras hechas,creadas por semana»). Es texto y no un objeto para que la definición de la herramienta sea chica (cupo de Groq). Si un bloque está mal, vuelve una explicación y el modelo corrige. |
| Bloques | `numero` (con comparación contra el período anterior de igual largo), `barras`, `lineas` (solo en el tiempo), `reparto` (por proyecto, área o prioridad) y `lista` (las tareas, hasta 300 filas). |
| Medidas | `hechas`, `creadas`, `a_tiempo`, `tarde`, `puntualidad` (% a tiempo de las que tenían fecha límite), `atraso` (promedio de días de las hechas tarde), y dos fotos de hoy: `vencidas` (sin hacer, con fecha pasada y anterior al fin del período) y `pendientes`. |
| Qué cuenta | Solo tareas principales (las subtareas son pasos de una tarea). Una tarea hecha cuenta aunque después se haya archivado. El día es el de la zona horaria de la persona. |
| Puntualidad | Compara el día en que se terminó con la fecha límite que la tarea tiene hoy: si la fecha se corrió, vale la última (no se guarda el historial de fechas). Las hechas sin fecha límite no entran en el porcentaje. Sin tareas con fecha, el valor es «sin dato», no 0 %. |
| El informe es una foto | Se guarda ya calculado (tabla `informes`, migración 0009): un informe viejo dice lo mismo aunque las tareas cambien. Para tener números nuevos se pide otro. Máximo 200 por persona. |
| Lectura del Agente | Un párrafo corto que escribe el modelo liviano a partir de los números (no ve las tareas). Es opcional: si no hay modelo o tarda más de 12 segundos, el informe sale sin lectura. |
| Deshacer | El informe aparece en el chat como una tarjeta con «Ver informe» y «Deshacer». Deshacer lo borra (se puede volver a pedir), igual que una nota de bitácora. |
| «Torta» | Si se pide una torta se arma un `reparto`: barras ordenadas con cantidad y porcentaje. Se comparan mejor que las porciones de un círculo, sobre todo cuando los valores son parecidos. |
| Un eje por gráfico | Un porcentaje o un promedio no comparte gráfico con cantidades: va en un bloque aparte. |
| Colores | Tres (azul, naranja, verde agua), validados de a pares con un verificador de paletas contra el fondo de la app y contra el papel: se distinguen con visión normal y con daltonismo. Cada medida tiene su color fijo (hechas y a tiempo, azul; tarde y vencidas, naranja; creadas y pendientes, verde). Dos medidas del mismo color no van en el mismo gráfico: el Agente recibe el aviso y las separa. Como mucho tres series. |
| Eje de tiempo | Si el período es largo, baja solo la precisión: de días a semanas (más de 45 días) y de semanas a meses (más de 30 semanas). Las semanas van de lunes a domingo, recortadas al período. |
| Rótulos | Con pocas columnas se rotulan todas; con muchas, solo la más alta. En las líneas, el último valor. El resto se lee con el eje, pasando el cursor (o tocando) o en «Ver como tabla». |
| Pantalla y PDF iguales | La geometría de cada gráfico se calcula una sola vez (`escena.ts`) y la dibujan el SVG de la pantalla y el PDF. |
| PDF | Se arma en el navegador con `pdf-lib` 1.17.1 (versión de 2021, estable y sin dependencias nativas; fijada). No hay servidor de por medio ni costo. Se carga recién al tocar «Descargar PDF». Tipografía Helvetica: lo que no puede escribir (emojis, flechas) se saca del texto. |
| Bajarlo en el teléfono | En pantallas táctiles se abre el menú de compartir del sistema (Guardar en Archivos, WhatsApp, correo); si el navegador exige un toque directo, el botón pasa a «Guardar PDF» con el archivo ya listo. En computadora se descarga. **No se pudo probar en un iPhone real.** |
| Tamaño de las herramientas | Para que `armar_informe` entre en los 7.000 caracteres (cupo de Groq), el esquema que ve el modelo ya no incluye largos mínimos y máximos ni la expresión regular cuando la descripción dice el formato. La validación no cambió. |
| Seguridad | La tabla es de la persona (RLS «propio: todo»): no protege plata ni cupos. Como podría escribirla directo por la API, la app valida la forma de `datos` antes de mostrarlo. |

## Interrumpir al Agente hablando, sin botón (pedido el 20/11/2026)

La persona pidió que la charla de voz sea más fluida: que al hablar el Agente se calle solo, sin tener que tocar «Interrumpir» cada vez. Usa la app instalada en un iPhone, con la voz del navegador.

La interrupción automática ya existía, pero casi nunca se disparaba: pedía un volumen alto (0,06) en **todas** las mediciones durante 350 ms seguidos, y el habla normal cae entre sílabas, así que cualquier caída reiniciaba la cuenta. Además el medidor usaba un contexto de audio propio, creado fuera de un toque, que en iPhone puede quedar suspendido (y un medidor suspendido mide cero).

| Tema | Decisión |
|---|---|
| Detección | `src/lib/voz/deteccion.ts`, lógica pura con pruebas. Se mide cada 40 ms y alcanza con que el 60 % de las mediciones de los últimos 300 ms (y al menos cuatro) superen el umbral: corta a los 160 a 240 ms de empezar a hablar. Un golpe o una tos corta no alcanzan. Reemplaza la regla de 350 ms seguidos de la fase 5. |
| Umbral | El mayor entre un mínimo fijo (0,022 de volumen eficaz en «Normal») y 1,7 veces lo que el micrófono oye del propio Agente. Ese eco se estima con lo medido mientras el Agente habla, con 400 ms de atraso para que la voz de la persona no suba la vara antes de ser detectada, y se recuerda de una frase a la siguiente. |
| No cortarse solo | Donde el eco se cancela (teléfonos, auriculares) el umbral queda en el mínimo y es sensible. Donde no (una notebook con parlantes) hay que hablar más fuerte que el parlante, o usar el botón. Si el eco sube de golpe (suben el volumen), a lo sumo se corta solo dos veces y se adapta. La primera vez que habla el Agente en la llamada no se interrumpe en los primeros 600 ms: todavía no se sabe cuánto eco hay. |
| Sensibilidad | Configuración → Voz → «Interrumpir al Agente hablando»: Normal, Más sensible, Menos sensible o Apagada. Se guarda en el dispositivo (`localStorage`), no en el perfil: depende del micrófono y del parlante de cada equipo. |
| Medidor más firme | Usa el contexto de audio de la página, el mismo que se habilita con cada toque; si queda suspendido o interrumpido, intenta reanudarlo. Si el sistema silencia el micrófono devuelve «no puedo medir» en lugar de cero. Si lo corta del todo, la pantalla lo vuelve a pedir mientras el Agente piensa o habla (como mucho cada 3 segundos). |
| Lo que se ve | Un aro verde alrededor del micrófono crece con la voz: muestra que la app oye, también mientras habla el Agente. Mientras habla dice «Hablá cuando quieras: me callo al instante» y deja un enlace chico para interrumpir a mano. Si no se puede medir, vuelve el botón «Interrumpir» con el aviso «Ahora no puedo oírte mientras hablo». Si el micrófono oye bastante al propio Agente (eco sin cancelar), lo dice: «para interrumpirme hablá fuerte; con auriculares anda mejor». |
| Solo mientras habla | Mientras el Agente piensa no se interrumpe por volumen: un ruido en ese momento descartaría la respuesta sin que se note. Si la persona sigue hablando, se corta apenas el Agente arranca. |
| Se siguen perdiendo las primeras sílabas | El reconocimiento de voz arranca recién al interrumpir (mientras habla el Agente está en pausa, porque en el teléfono no conviven). Conviene seguir la frase o repetir la primera palabra. |
| «Hablando» no queda trabado | Si el teléfono nunca avisa que terminó una frase y además dice que sigue hablando, la frase se da por dicha a un tope según su largo (3 s más 130 ms por letra, el doble de lo que tarda). Antes quedaba en «Hablando» hasta tocar «Interrumpir». |
| Sin probar en un iPhone | La lógica está probada con secuencias armadas y en la recorrida con un micrófono de mentira. No se pudo probar con un micrófono y un parlante reales: los umbrales salen de valores típicos y puede hacer falta ajustarlos con lo que la persona observe (para eso están el aro y la sensibilidad). |

## Llamada en vivo: hablarle encima al Agente, como por teléfono (pedido el 20/11/2026)

Después de publicar la interrupción por volumen, la persona la probó en su iPhone: «traté de hablar mientras el agente habla y no se corta; tiene que imitar lo que es una llamada».

**Por qué no se arreglaba ajustando lo que había.** El motor por turnos usa la voz y el dictado *del sistema* (Web Speech API). En iPhone esos dos toman el audio del teléfono: mientras la voz del sistema habla, el micrófono de la página no queda escuchando de forma confiable, y el dictado tiene que estar en pausa. Ningún umbral lo resuelve. Una llamada de verdad necesita que el micrófono y la voz pasen los dos por el audio de la propia página (así el teléfono le quita el eco) y un servicio que escuche mientras habla. Esto es un diagnóstico por descarte: no hay un iPhone para confirmarlo.

| Tema | Decisión |
|---|---|
| Servicio | La API en vivo de Gemini (Live API): voz a voz, detecta sola cuándo la persona empieza a hablar y corta al Agente, admite herramientas y se usa con la clave de Gemini que ya estaba cargada. Descartados: Azure Speech (no hay cuenta y sigue siendo por turnos), ElevenLabs (la persona lo prohibió para esta app), reconocer y sintetizar dentro del navegador (demasiado pesado para un teléfono). |
| Costo | Gratuito: plan gratuito de Gemini, con el límite diario propio del modelo en vivo. No se activó facturación en ningún lado. Si el cupo se agota, la llamada sigue por turnos. |
| Quién piensa | Durante una llamada en vivo responde el modelo en vivo de Gemini (`gemini-3.8-live`, se cambia con `GEMINI_MODEL_VIVO`), **no Claude**. Consecuencia: las llamadas dejan de gastar presupuesto de Claude. El chat escrito no cambia, y el resumen al cortar lo hacen los proveedores de siempre. |
| Privacidad | El audio de la llamada lo procesa Google y, en el plan gratuito, puede usarlo para mejorar sus productos (lo mismo que ya pasaba con el chat de texto con Gemini). Está dicho en Configuración → Voz, y cada dispositivo puede elegir «por turnos». |
| La clave | No sale del servidor. El navegador recibe un token de un solo uso (dos minutos para conectarse, media hora de vida) que lleva fijados el modelo, las instrucciones, las herramientas y la voz: con él no se puede abrir otra cosa. El WebSocket es directo entre el navegador y Google porque Vercel no puede sostener uno. |
| Sin SDK | El protocolo está escrito a mano en `voz/vivo/protocolo.ts`, como el resto de los proveedores. El SDK oficial (`@google/genai` 3.x) tenía días de publicado. Como la documentación oficial no se podía abrir desde donde se desarrolló, el formato de los mensajes se sacó del código de ese SDK (3.6.1) y se comprobó contra el servicio real (ver abajo). |
| Herramientas | Las pide el servicio y las ejecuta el servidor (`/api/voice/vivo/turno`) con la sesión de la persona: mismo registro de cambios y «Deshacer». El pedido lo retransmite el navegador, así que alguien con sesión podría inventar uno; no es un riesgo nuevo, porque solo puede hacer lo que ya puede con sus propios datos (RLS). No protege plata ni cupos. |
| Transcripción | Se guarda lo que el servicio transcribe de cada lado, al final de cada ida y vuelta. Puede tener errores de reconocimiento, y si la persona interrumpe, lo guardado del Agente puede incluir alguna palabra que no llegó a sonar. |
| Conexiones de pocos minutos | El servicio corta cada conexión a los pocos minutos y avisa antes. Se abre otra cuando el Agente termina de hablar, y el servidor le pasa los últimos 30 mensajes dentro de las instrucciones. Se prefirió eso a la «reanudación de sesión» del servicio: es más simple, se puede probar y también sirve si la conexión se cae sola. |
| Estado de las tareas | La foto se arma en cada conexión (no se usa la congelada del chat): acá no hay caché que cuidar, y así una reconexión ya ve los cambios hechos en la llamada. |
| Respaldo | Si no arranca, o se cae y tres intentos no la levantan (o hay más de cuatro reconexiones en un minuto), la pantalla sigue por turnos con lo conversado y avisa. Nunca queda una llamada muda. |
| Interrumpir | Lo decide el servicio escuchando el audio. El ajuste «Interrumpir al Agente hablando» de Configuración se reutiliza: más o menos sensible cambia qué tan fácil da por empezada una frase; «Apagada» hace que no se lo pueda cortar hablando. El enlace para interrumpir a mano sigue: calla el parlante y descarta lo que faltaba de esa respuesta. |
| Audio | Un solo contexto de audio (el que se habilita con el toque). El micrófono sale en trozos de unos 40 ms a 16 kHz por un AudioWorklet (`public/audio/captura.js`); si el navegador no lo deja cargar, por el procesador clásico. La voz llega a 24 kHz y se encola en el parlante. En iPhone se le avisa al sistema que la página habla y escucha a la vez (`navigator.audioSession`), y durante la llamada se pide que la pantalla no se apague. |
| Diagnóstico | La pantalla le cuenta al servidor qué pasó con la conexión (`/api/voice/vivo/aviso`): queda en los registros como `[vivo]`, sin nada de lo conversado. Es la forma de saber qué pasó en el teléfono de la persona sin tenerlo a mano. |
| Límites | `voz_vivo` (conexiones): 6 por minuto, 120 por día. `vivo_turno` (guardar cada ida y vuelta): 40 por minuto, 2.000 por día; es propio porque una charla fluida hace más idas y vueltas que un chat escrito. |
| Comprobado con el servicio real (20/11/2026) | Antes de habilitarla se probó desde el servidor de producción, con una sonda temporal que ya se borró (abría una sesión de prueba, sin datos de nadie). Resultados con `gemini-3.8-live` y la clave gratuita: acepta los ajustes con todas las herramientas del Agente; conecta en 0,3 s; responde con voz en menos de 1 s a un texto; pide una herramienta, recibe el resultado y lo comenta; y con voz de verdad por el «micrófono» (una frase dicha por el propio servicio, pasada por nuestro conversor a 16 kHz) entendió la frase palabra por palabra, empezó a responder 1,5 s después del final y **se interrumpió a los 0,17 a 0,2 s de hablarle encima** (con sensibilidad normal y baja; con «Apagada» no se interrumpe, como corresponde). |
| Lo que mostró el servicio real | Cierra el turno apenas pide una herramienta y responde en un turno nuevo (la pantalla sigue en «Pensando…» mientras se aplica). Manda toda la respuesta más rápido de lo que se escucha y da el turno por terminado cuando calcula que terminó de sonar: por eso la interrupción se resuelve callando el parlante acá. Tras una interrupción manda además el cierre del turno cortado, que se ignora. |
| Sin probar | **Un teléfono de verdad.** El micrófono, el parlante y la cancelación de eco del iPhone no se pueden probar desde acá: si el teléfono no cancela bien el eco, el Agente podría cortarse solo (para eso está la sensibilidad, y los auriculares lo evitan). Tampoco se conoce el límite diario gratuito del modelo en vivo: si se agota, la llamada pasa a turnos y queda anotado en los registros `[vivo]`. |
| Mensajes de aviso que se corrigieron de paso | Los avisos del arranque de una llamada por turnos (sin permiso de micrófono, cupo de Azure) se pisaban con el primer cambio de estado y no llegaban a verse. Ahora se muestran. |

## Aspecto nuevo: «Punto» con serif, tema oscuro o claro y color a elección (pedido el 24/11/2026)

La persona pidió cambiar la estética: algo minimalista, con onda, y poder pasar de oscuro a claro. Se le mostraron maquetas en tres rondas (seis estilos; variantes de los dos que más le gustaron; y el elegido con seis tipografías) y eligió **5D-6: «Punto Ámbar» con serif**. Pidió además poder elegir el color principal dentro de la app y que no fuera siempre ámbar.

| Tema | Decisión |
|---|---|
| Qué se tomó de la maqueta | Mosaicos redondeados sin borde sobre fondo negro (o gris claro), separadores punteados, botones y campos en píldora, casillas redondas, títulos y números en Instrument Serif, el resto en Inter. En Hoy: tira de la semana y mosaico de la próxima llamada relleno con el color principal. En la llamada: círculo de puntos, estado en serif grande y tres botones redondos. |
| Color de entrada | **Sin color**: lo destacado va en el color del texto (blanco en oscuro, negro en claro). La persona pidió que no fuera ámbar y no dijo cuál; blanco y negro no choca con ningún color de estado y junta los dos estilos que más le gustaron. Se cambia en Configuración → Aspecto. |
| Colores que se ofrecen | Sin color y diez colores (rojo, naranja, ámbar, lima, verde, turquesa, celeste, azul, violeta, rosa), más «Otro color» con el selector del sistema para elegir cualquiera. |
| Cualquier color tiene que leerse | El color elegido se usa tal cual en los rellenos, con negro o blanco encima según cuál contraste más. Para texto, íconos y bordes se usa una versión aclarada (tema oscuro) u oscurecida (tema claro) lo justo para llegar a 4,5:1 sobre la superficie más difícil de cada tema. Está probado con colores difíciles (amarillo puro, blanco, negro, azul muy oscuro). |
| Tema de entrada | Oscuro, que es como venía la app. Además hay claro y «automático» (sigue al dispositivo). El botón del encabezado alterna entre oscuro y claro; si estaba en automático, queda fijo en el contrario de lo que se veía. |
| Dónde se guarda | En cookies del dispositivo, no en el perfil. Con cookies el servidor arma la página ya con el aspecto elegido y no hay un parpadeo del tema anterior al abrir; desde el perfil haría falta una consulta más en cada página o un script en línea. La contra: en otro dispositivo hay que elegirlo de nuevo. No protege plata ni cupos. |
| Enlaces subrayados | Sin color principal, un enlace de color se vería igual que el texto: todos los enlaces dentro de un texto van subrayados. |
| El color principal dejó de usarse como señal | Antes el ámbar marcaba cosas (prioridad P1, la hora de hoy, la chispa de las fechas del Agente). Como ahora puede no haber color, esas señales se apoyan también en el peso de la letra, el ícono o el texto. Lo hecho se marca con el color principal (antes verde); el verde queda para «te escucho» en la llamada y los avances. |
| Tipografías propias | Los archivos de Inter e Instrument Serif (licencia OFL, incluida) están en el repositorio y los sirve la app: no hay pedidos a Google ni depende de la red al compilar. Inter reemplaza a Geist Sans, como en la maqueta elegida; Geist Mono queda para lo monoespaciado. Solo el juego latino (alcanza para español). |
| Barra de abajo en el celular | Una píldora flotante con cinco íconos sin texto, como en la maqueta; la sección abierta va rellena. Los nombres siguen estando para lectores de pantalla. La contra: los íconos solos se descubren un poco menos. |
| Mosaico «Próxima llamada» | Muestra la llamada ya creada para hoy o, si todavía no existe, la próxima según las rutinas (hasta una semana adelante). Con la hora cumplida cambia a «Tu Agente te está llamando» y ofrece «Atender». Sin rutinas no aparece (ahí ya avisa el cartel de siempre). El aviso flotante de llamada en espera se mantiene en todas las pantallas. |
| iPhone con la app instalada | El sistema dibuja la hora y la batería en blanco encima de la página. Con el tema claro no se leerían: queda una franja negra detrás, del alto de esa zona. En el navegador no se ve. **Sin probar en un iPhone.** |
| Gráficos | En el tema claro usan los colores que ya estaban validados para el PDF; en el oscuro, los de siempre. |
| Error que apareció de paso | «Hechas hoy» comparaba la fecha con la zona horaria del dispositivo y «hoy» se calcula con la del perfil: cerca de la medianoche, o con el dispositivo en otra zona, lo recién hecho no aparecía. Ahora usan la misma. |
| Cómo se revisó | Con capturas de la recorrida en un navegador de escritorio: ancho de computadora y de celular, tema oscuro y claro, con y sin color. No se vio en un teléfono de verdad. |

## Despliegue

- **Proyecto de Vercel `miagente`** (equipo MiAgente), enlazado a `miagente681-cloud/Agente`. El repo estaba vacío: el código de la fase 1 se trajo desde `Emontone21/MiAg` con su historial.
- **La rama de producción de Vercel sigue siendo `claude/pensive-galileo-w7i9nk`** porque fue la primera que se subió. `main` ya existe con el mismo código; el cambio de rama de producción queda como paso manual en `CREDENCIALES.md`, para no arriesgar el despliegue en uso.
- **Migraciones 0002, 0003 y 0004 aplicadas en el proyecto real** de Supabase (solo agregan columnas, una función, un índice y el trabajo del cron).
