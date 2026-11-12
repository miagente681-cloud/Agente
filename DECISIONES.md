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

## Despliegue

- **Proyecto de Vercel `miagente`** (equipo MiAgente), enlazado a `miagente681-cloud/Agente`. El repo estaba vacío: el código de la fase 1 se trajo desde `Emontone21/MiAg` con su historial.
- **La rama de producción de Vercel sigue siendo `claude/pensive-galileo-w7i9nk`** porque fue la primera que se subió. `main` ya existe con el mismo código; el cambio de rama de producción queda como paso manual en `CREDENCIALES.md`, para no arriesgar el despliegue en uso.
- **Migraciones 0002, 0003 y 0004 aplicadas en el proyecto real** de Supabase (solo agregan columnas, una función, un índice y el trabajo del cron).
