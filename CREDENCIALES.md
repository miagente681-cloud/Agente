# Credenciales: qué cargar, en qué orden y cómo comprobarlo

Todo se carga como variable de entorno. **En Vercel:** proyecto `miagente` → Settings → Environment Variables, marcando *Production* y *Preview*. Después de cargar o cambiar variables hay que **volver a desplegar** (Deployments → ⋯ → Redeploy): las que empiezan con `NEXT_PUBLIC_` se fijan al compilar.

Para ver qué falta en cualquier momento: entrá a la app → Configuración → **Estado de las integraciones** (`/configurar`). Muestra cada integración como configurada o pendiente y nunca muestra valores.

Ninguna clave va en el código ni se pega en un chat. Todo lo de esta lista es gratuito y no requiere activar facturación, salvo Claude (paso 1), que es el único proveedor pago autorizado y funciona con un tope de gasto mensual. Azure pide una tarjeta para verificar identidad aunque su nivel gratuito no cobra (paso 9).

El orden está pensado para que cada paso destrabe algo que se pueda probar.

---

## 0. Variables nuevas de seguridad (11/11/2026) — cargalas primero

Después de la auditoría de seguridad, **Claude solo responde a los correos de una lista**. Mientras no cargues estas variables, nadie usa Claude: el Agente sigue funcionando con Gemini y Groq, y `/configurar` muestra «Esta página es solo para quien administra la app».

| Variable | Valor | Tipo en Vercel | Qué pasa si falta |
|---|---|---|---|
| `CLAUDE_USUARIOS_PERMITIDOS` | Tu correo de la app. Si son varios, separados por coma. Se comparan sin importar mayúsculas. | Plain (no es secreta), *Production* y *Preview* | Nadie usa Claude; responden los gratuitos. `/configurar` y el detalle de integraciones no se muestran a nadie. |
| `CLAUDE_TOPE_USD_GLOBAL` | `10` (o el monto que quieras) | Plain, *Production* y *Preview* | Vale 10. Es el tope de **todo el despliegue** sumando a todas las personas. El tope de Configuración solo puede bajar el de cada uno. |
| `NEXT_PUBLIC_REGISTRO_ABIERTO` | No la cargues | — | El ingreso por código no crea cuentas nuevas (lo correcto). |

Después de cargarlas: **Redeploy**. Para comprobar: `/configurar` tiene que mostrar «Quién puede usar Claude: Configurada», y en Configuración → Cerebro del Agente → **Probar conexión** tiene que decir «Anda».

La clave de servicio de Supabase (paso 3) ahora es **obligatoria para que el Agente responda**: con ella se cuentan los límites de uso por persona y se registra el gasto de Claude. Ya está cargada.

### Ajustes de seguridad del panel de Supabase (no se pueden hacer desde el código)

Cualquiera puede hablarle a la API de Supabase sin pasar por la app, así que estos ajustes son la barrera real. Estado comprobado el 11/11/2026 con la API de administración:

| Ajuste | Dónde | Cómo tiene que estar | Estado |
|---|---|---|---|
| Registro de usuarios nuevos | Authentication → Sign In / Providers → **Allow new users to sign up** | Apagado | Estaba **encendido** (el cambio a mano no había quedado). Lo apagué desde la API el 11/11/2026; conviene mirar que figure apagado. |
| Confirmación de correo | Authentication → Sign In / Providers → Email → **Confirm email** | Encendido | Encendido. |
| Largo mínimo de contraseña | Authentication → Sign In / Providers → Email → **Minimum password length** | 8 o más | 8. |
| Contraseñas filtradas (HaveIBeenPwned) | Authentication → Sign In / Providers → Email → **Prevent use of leaked passwords** | Encendido si el plan lo permite | No disponible: es solo del plan Pro o superior. En el plan gratuito queda el largo mínimo. |
| **Max rows** de la API | Project Settings → Data API → **Max rows** | 1000 (el valor por defecto) | 1000. La app ya no depende de este valor para el tope de gasto (lo suma la base), pero un número bajo limita cuánto puede bajar alguien de una sola vez. |

Si en algún momento querés abrir el registro: encendé «Allow new users to sign up» **y** cargá `NEXT_PUBLIC_REGISTRO_ABIERTO=true`. Las dos cosas, o ninguna.

## 1. Claude (API de Anthropic) — el cerebro principal, con tope de gasto

| | |
|---|---|
| Variable | `ANTHROPIC_API_KEY` |
| Para qué | Que el Agente responda con Claude: Haiku 5.5 en el chat y las tareas de fondo, Sonnet 5.5 en las llamadas programadas y la entrevista inicial. Sin esta clave, el Agente usa Gemini, Groq u Ollama como hasta ahora. |
| Dónde se carga | Vercel, en *Production* y *Preview*, tipo **Secret** (sensible). Nunca con `NEXT_PUBLIC_`. |
| Costo | Es el único proveedor pago. La app corta en **US$ 10 por mes para todo el despliegue** (`CLAUDE_TOPE_USD_GLOBAL`; en Configuración cada persona solo puede bajar el suyo) y avisa al 80 %. Además conviene poner un límite en la consola (punto 4 de abajo). |
| Requisitos | `CLAUDE_USUARIOS_PERMITIDOS` con tu correo y la clave de servicio de Supabase (paso 0). |

**Paso a paso** (verificado en la documentación oficial el 11/11/2026):

1. **Cuenta.** Entrá a platform.claude.com y creá una cuenta de la Claude Console, o iniciá sesión.
2. **Crédito.** En la consola, Settings → **Billing** (`platform.claude.com/settings/billing`), cargá crédito. Con US$ 5 o 10 alcanza para empezar: el chat con Haiku cuesta fracciones de centavo por mensaje.
3. **Clave.** Settings → **API keys** (`platform.claude.com/settings/keys`) → *Create key*. Ponele un nombre (por ejemplo «MiAgente») y copiala: se muestra una sola vez. Empieza con `sk-ant-`.
4. **Límite de gasto en la consola** (recomendado, como segunda barrera además del tope de la app). En la misma página **Billing**, sección **Spend limits**, tocá *Set limit* (o *Adjust limit* si ya hay uno) y poné un monto mensual, por ejemplo US$ 15. Cuando se alcanza, la API responde con un error y la app pasa sola a los modelos gratuitos.
5. **Vercel.** Proyecto `miagente` → Settings → Environment Variables → *Add*: nombre `ANTHROPIC_API_KEY`, tipo **Secret**, marcá *Production* y *Preview*, pegá la clave y guardá.
6. **Volver a desplegar.** Deployments → ⋯ del último → *Redeploy*.

**Cómo comprobar que quedó bien (dos minutos):**

1. Configuración → **Cerebro del Agente**: Claude tiene que figurar «Configurado» y primero en la lista.
2. Tocá **Probar conexión**: tiene que decir «Anda: respondió Claude Haiku 5.5 en … ms». Si dice que la clave no es válida, revisá que la copiaste entera; si dice que no hay crédito, cargá crédito o subí el límite de la consola.
3. Escribile algo al Agente. Debajo de la respuesta tiene que aparecer **Claude Haiku 5.5**.
4. Volvé a Configuración: en **Gasto de este mes** tiene que aparecer el gasto (será de fracciones de centavo), con el desglose por uso y por modelo.

El gasto que muestra la app es una estimación hecha con los precios publicados. El gasto real está en la consola de Claude.

## 2. Supabase, clave pública — para poder entrar

| | |
|---|---|
| Variable | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`NEXT_PUBLIC_SUPABASE_URL` ya está cargada) |
| Para qué | Que la app hable con la base. Sin esto solo se ve `/configurar`. |
| Dónde se consigue | Supabase → tu proyecto → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`). |
| Dónde se carga | Vercel. No es secreta (llega al navegador). |
| Destraba | Ingreso, panel completo (Hoy, Tablero, Calendario, Proyectos). |
| Cómo comprobar | Redesplegá y abrí la app: tiene que aparecer la pantalla de ingreso en lugar de «Falta conectar la base de datos». |

## 3. Supabase, clave de servicio

| | |
|---|---|
| Variable | `SUPABASE_SERVICE_ROLE_KEY` |
| Para qué | Lo que el servidor hace sin tu sesión: registrar el gasto de Claude, contar los límites de uso por persona, programador de llamadas, contador de voz de Azure y borrar la cuenta. **Sin ella el Agente no responde.** |
| Dónde se consigue | Misma pantalla → **Secret key** (`sb_secret_…`). |
| Dónde se carga | Vercel, marcada como **Sensitive**. Nunca con `NEXT_PUBLIC_`. |
| Destraba | Pasos 7, 8 y 9. |
| Cómo comprobar | `/configurar` → «Supabase, clave de servicio: Configurada». |

## 4. Correo con código (Brevo) — para entrar desde el iPhone

Sin esto el correo trae solo el enlace (que en iPhone abre Safari y no la app instalada), solo llega a miembros del proyecto de Supabase y hay un tope de 2 por hora.

1. Creá una cuenta gratuita en brevo.com (300 correos por día, sin tarjeta) y verificá un remitente (Senders → Add a sender).
2. En Brevo: SMTP & API → SMTP → generá una **clave SMTP**. Anotá también el *login* que muestra.
3. En Supabase: Authentication → Emails → **SMTP Settings** → Enable Custom SMTP: host `smtp-relay.brevo.com`, puerto `587`, usuario = el login de Brevo, contraseña = la clave SMTP, remitente = el que verificaste.
4. En Supabase: Authentication → Emails → Templates → **Magic Link** y **Confirm signup**: pegá el contenido de `supabase/plantillas/correo-de-ingreso.html` (trae el código con `{{ .Token }}`). Asunto sugerido: «Tu código para entrar a MiAgente». Si preferís, pedímelo y lo cargo yo: lo intenté y Supabase lo rechaza mientras no haya SMTP propio.

No hay variable para cargar en Vercel. **Cómo comprobar:** pedí el acceso desde la app; el correo tiene que traer un código de 6 dígitos y el código tiene que dejarte entrar.

## 5. Gemini — el cerebro gratuito

| | |
|---|---|
| Variables | `GEMINI_API_KEY` (y opcionales `GEMINI_MODEL_CHAT`, `GEMINI_MODEL_FONDO`) |
| Dónde se consigue | aistudio.google.com → Get API key → Create API key, en un proyecto **sin facturación**. |
| Dónde se carga | Vercel, como Sensitive. |
| Modelos | Por defecto `gemini-3.6-flash` para conversar y `gemini-3.5-flash-lite` para resumir. En AI Studio (Rate limits) fijate qué modelos Flash y Flash-Lite figuran como gratuitos en tu proyecto y, si los nombres son otros, cargalos en las dos variables opcionales. |
| Destraba | Chat, entrevista inicial, resúmenes y memorias. |
| Cómo comprobar | Configuración → Cerebro del Agente → «Gemini: Configurado». Después escribí «hola» en Agente. Si responde con error de modelo, el nombre del modelo no existe o no es gratuito: corregí las variables opcionales. |

Ojo con el cupo: según reportes (no oficiales) los modelos Flash gratuitos tienen muy pocos pedidos por día. Por eso conviene cargar también Groq.

## 6. Groq — el respaldo

| | |
|---|---|
| Variables | `GROQ_API_KEY` (opcional `GROQ_MODEL`, por defecto `openai/gpt-oss-120b`) |
| Dónde se consigue | console.groq.com → API Keys → Create API Key (plan gratuito, sin tarjeta). |
| Dónde se carga | Vercel, como Sensitive. |
| Destraba | Que la conversación siga sola cuando Gemini llega a su límite. |
| Cómo comprobar | «Groq: Configurado». Para verlo actuar, en Configuración subí Groq al primer lugar y hablá con el Agente; en el detalle de la sesión dice «Respondió Groq». |

## 7. Notificaciones push (claves VAPID) — se generan, no se piden

**Hecho el 12/11/2026:** las tres variables están cargadas en Vercel. Lo de abajo queda por si hay que cambiarlas.

En cualquier computadora con Node:

```bash
npx web-push@3.6.7 generate-vapid-keys
```

Imprime una *Public Key* y una *Private Key*.

| Variable | Valor | Dónde |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | la Public Key | Vercel |
| `VAPID_PRIVATE_KEY` | la Private Key | Vercel, Sensitive |
| `VAPID_SUBJECT` | La dirección de la app | **Ya está cargada** (12/11/2026) |

**Destraba:** los recordatorios (Configuración → Recordatorios) y el aviso en el celular a la hora de la llamada. **Cómo comprobar:** redesplegá; en el celular (en iPhone, con la app instalada en la pantalla de inicio) Configuración → Notificaciones → Activar → «Enviar una de prueba». Si cambiás las claves más adelante, cada dispositivo tiene que desactivar y volver a activar.

## 8. Programador de llamadas (secreto del cron) — se genera

**Hecho el 12/11/2026:** `CRON_SECRET` está en Vercel y los dos valores en Supabase; el programador responde 200 cada minuto. Lo de abajo queda por si hay que rehacerlo (si los valores ya existen, se cambian con `vault.update_secret`).

No hace falta ninguna terminal: el secreto se genera dentro de Supabase.

1. En Supabase → SQL Editor, ejecutá esto tal cual. Guarda la dirección de la app y un secreto nuevo, y te lo muestra:

```sql
select vault.create_secret('https://miagente-zeta.vercel.app', 'miagente_app_url');
select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'miagente_cron_secret');
select decrypted_secret from vault.decrypted_secrets where name = 'miagente_cron_secret';
```

2. Copiá el valor que devuelve la última línea y cargalo en Vercel como `CRON_SECRET` (Sensitive, *Production*). Redesplegá.

El trabajo que corre cada minuto ya está creado y funcionando en tu proyecto (lo verifiqué); mientras falten esos dos valores no hace nada. Para cambiarlos más adelante: `select vault.update_secret((select id from vault.secrets where name = 'miagente_cron_secret'), 'NUEVO-VALOR');`

**Destraba:** que los recordatorios y las llamadas de tus rutinas se disparen y se reprogramen solas. **Cómo comprobar:** creá una rutina para dentro de 3 minutos (Configuración → Rutinas de llamada) y esperá: tiene que aparecer el aviso «Tu Agente te está llamando» en la app y, si hiciste el paso 7, la notificación. Para ver las respuestas del servidor: `select status_code, content from net._http_response order by created desc limit 5;` (200 = bien, 401 = el secreto no coincide, 503 = falta `CRON_SECRET` o la clave de servicio en Vercel).

## 9. Azure Speech — opcional

Sin esto las llamadas funcionan igual con el reconocimiento y la voz del navegador. Azure suena mejor y anda en más navegadores.

**Antes de decidir:** crear la cuenta de Azure pide una tarjeta para verificar identidad. El recurso que se usa es el nivel **F0 (gratuito)**, que no cobra y no pasa a pago solo; si no querés poner una tarjeta, salteá este paso.

1. portal.azure.com → Crear un recurso → **Speech** → plan de tarifa **Free F0**. Elegí una región (por ejemplo `brazilsouth` o `eastus`).
2. En el recurso: Keys and Endpoint → copiá **KEY 1** y la **región** (el nombre corto, sin espacios).

| Variable | Valor | Dónde |
|---|---|---|
| `AZURE_SPEECH_KEY` | KEY 1 | Vercel, Sensitive |
| `AZURE_SPEECH_REGION` | por ejemplo `brazilsouth` | Vercel |

Necesita además el paso 3. **Cómo comprobar:** Configuración → Voz → «Azure configurado» y las barras de uso del mes. En una llamada, arriba a la derecha dice «Voz: Azure».

## 10. Modelo local con Ollama — opcional

Sirve para no depender de cupos y para que los datos no salgan de tu computadora. Solo responde con la computadora prendida; si no contesta en 6 segundos se pasa al siguiente proveedor.

**Qué modelo instalar** (según hardware; tamaños aproximados, tomados de terceros):

| Tu computadora | Modelo | Comando |
|---|---|---|
| 8 GB de RAM, sin placa de video | `qwen3:4b` (~2,5 GB) | `ollama pull qwen3:4b` |
| 16 GB de RAM | `qwen3:8b` (~5 GB) | `ollama pull qwen3:8b` |
| Placa de video de 8 a 12 GB | `qwen3:8b` o `gemma4:e4b` | `ollama pull gemma4:e4b` |

Los tres admiten herramientas. No encontré mediciones de calidad en español: probá con tus propias conversaciones antes de ponerlo primero.

**Cómo conectarlo** (el servidor corre en Vercel y no ve tu `localhost`). Ollama no tiene contraseña propia, así que nunca hay que exponerlo directo. La forma más simple y segura:

1. Poné delante un proxy que exija un token. Con Caddy, un archivo `Caddyfile`:

   ```
   :8787 {
     @sin_token not header Authorization "Bearer UN-TOKEN-LARGO-INVENTADO"
     respond @sin_token 401
     reverse_proxy 127.0.0.1:11434
   }
   ```

2. Publicá **ese puerto** (8787, no el 11434) con un túnel gratuito, por ejemplo `cloudflared tunnel --url http://localhost:8787` o Tailscale Funnel. Te da una dirección `https://…`.

| Variable | Valor |
|---|---|
| `OLLAMA_BASE_URL` | la dirección https del túnel |
| `OLLAMA_MODEL` | por ejemplo `qwen3:8b` |
| `OLLAMA_AUTH_TOKEN` | el token del Caddyfile (Sensitive) |

**Cómo comprobar:** «Modelo local: Configurado»; subilo al primer lugar y hablá con el Agente. Apagá la computadora y volvé a hablar: tiene que responder otro proveedor sin que hagas nada. Este camino no lo pude probar con un Ollama real.

## 11. Después de cargar todo

- **Pasar la producción a `main`.** Vercel → Settings → Environments → Production → Branch Tracking → `main`. La rama `main` ya existe con el mismo código. No lo cambié yo para no arriesgar el despliegue en uso.
- **URL de la app en Supabase Auth.** Ya está: `site_url` y las redirecciones apuntan a `miagente-mi-agente1.vercel.app` y `miagente-zeta.vercel.app`. Si usás otro dominio, agregalo en Authentication → URL Configuration.
