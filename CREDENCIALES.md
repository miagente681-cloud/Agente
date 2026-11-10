# Credenciales: qué cargar, en qué orden y cómo comprobarlo

Todo se carga como variable de entorno. **En Vercel:** proyecto `miagente` → Settings → Environment Variables, marcando *Production* y *Preview*. Después de cargar o cambiar variables hay que **volver a desplegar** (Deployments → ⋯ → Redeploy): las que empiezan con `NEXT_PUBLIC_` se fijan al compilar.

Para ver qué falta en cualquier momento: entrá a la app → Configuración → **Estado de las integraciones** (`/configurar`). Muestra cada integración como configurada o pendiente y nunca muestra valores.

Ninguna clave va en el código ni se pega en un chat. Todo lo de esta lista es gratuito y no requiere activar facturación, con una salvedad en Azure (paso 7).

El orden está pensado para que cada paso destrabe algo que se pueda probar.

---

## 1. Supabase, clave pública — para poder entrar

| | |
|---|---|
| Variable | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`NEXT_PUBLIC_SUPABASE_URL` ya está cargada) |
| Para qué | Que la app hable con la base. Sin esto solo se ve `/configurar`. |
| Dónde se consigue | Supabase → tu proyecto → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`). |
| Dónde se carga | Vercel. No es secreta (llega al navegador). |
| Destraba | Ingreso, panel completo (Hoy, Tablero, Calendario, Proyectos). |
| Cómo comprobar | Redesplegá y abrí la app: tiene que aparecer la pantalla de ingreso en lugar de «Falta conectar la base de datos». |

## 2. Supabase, clave de servicio

| | |
|---|---|
| Variable | `SUPABASE_SERVICE_ROLE_KEY` |
| Para qué | Lo que el servidor hace sin tu sesión: programador de llamadas, contador de voz de Azure y borrar la cuenta. |
| Dónde se consigue | Misma pantalla → **Secret key** (`sb_secret_…`). |
| Dónde se carga | Vercel, marcada como **Sensitive**. Nunca con `NEXT_PUBLIC_`. |
| Destraba | Pasos 7, 8 y 9. |
| Cómo comprobar | `/configurar` → «Supabase, clave de servicio: Configurada». |

## 3. Correo con código (Brevo) — para entrar desde el iPhone

Sin esto el correo trae solo el enlace (que en iPhone abre Safari y no la app instalada), solo llega a miembros del proyecto de Supabase y hay un tope de 2 por hora.

1. Creá una cuenta gratuita en brevo.com (300 correos por día, sin tarjeta) y verificá un remitente (Senders → Add a sender).
2. En Brevo: SMTP & API → SMTP → generá una **clave SMTP**. Anotá también el *login* que muestra.
3. En Supabase: Authentication → Emails → **SMTP Settings** → Enable Custom SMTP: host `smtp-relay.brevo.com`, puerto `587`, usuario = el login de Brevo, contraseña = la clave SMTP, remitente = el que verificaste.
4. En Supabase: Authentication → Emails → Templates → **Magic Link** y **Confirm signup**: pegá el contenido de `supabase/plantillas/correo-de-ingreso.html` (trae el código con `{{ .Token }}`). Asunto sugerido: «Tu código para entrar a MiAgente». Si preferís, pedímelo y lo cargo yo: lo intenté y Supabase lo rechaza mientras no haya SMTP propio.

No hay variable para cargar en Vercel. **Cómo comprobar:** pedí el acceso desde la app; el correo tiene que traer un código de 6 dígitos y el código tiene que dejarte entrar.

## 4. Gemini — el cerebro principal

| | |
|---|---|
| Variables | `GEMINI_API_KEY` (y opcionales `GEMINI_MODEL_CHAT`, `GEMINI_MODEL_FONDO`) |
| Dónde se consigue | aistudio.google.com → Get API key → Create API key, en un proyecto **sin facturación**. |
| Dónde se carga | Vercel, como Sensitive. |
| Modelos | Por defecto `gemini-3.6-flash` para conversar y `gemini-3.5-flash-lite` para resumir. En AI Studio (Rate limits) fijate qué modelos Flash y Flash-Lite figuran como gratuitos en tu proyecto y, si los nombres son otros, cargalos en las dos variables opcionales. |
| Destraba | Chat, entrevista inicial, resúmenes y memorias. |
| Cómo comprobar | Configuración → Cerebro del Agente → «Gemini: Configurado». Después escribí «hola» en Agente. Si responde con error de modelo, el nombre del modelo no existe o no es gratuito: corregí las variables opcionales. |

Ojo con el cupo: según reportes (no oficiales) los modelos Flash gratuitos tienen muy pocos pedidos por día. Por eso conviene cargar también Groq.

## 5. Groq — el respaldo

| | |
|---|---|
| Variables | `GROQ_API_KEY` (opcional `GROQ_MODEL`, por defecto `openai/gpt-oss-120b`) |
| Dónde se consigue | console.groq.com → API Keys → Create API Key (plan gratuito, sin tarjeta). |
| Dónde se carga | Vercel, como Sensitive. |
| Destraba | Que la conversación siga sola cuando Gemini llega a su límite. |
| Cómo comprobar | «Groq: Configurado». Para verlo actuar, en Configuración subí Groq al primer lugar y hablá con el Agente; en el detalle de la sesión dice «Respondió Groq». |

## 6. Notificaciones push (claves VAPID) — se generan, no se piden

En cualquier computadora con Node:

```bash
npx web-push@3.6.7 generate-vapid-keys
```

Imprime una *Public Key* y una *Private Key*.

| Variable | Valor | Dónde |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | la Public Key | Vercel |
| `VAPID_PRIVATE_KEY` | la Private Key | Vercel, Sensitive |
| `VAPID_SUBJECT` | `mailto:` seguido de tu correo | Vercel |

**Destraba:** el aviso en el celular a la hora de la llamada. **Cómo comprobar:** redesplegá; en el celular (en iPhone, con la app instalada en la pantalla de inicio) Configuración → Notificaciones → Activar → «Enviar una de prueba». Si cambiás las claves más adelante, cada dispositivo tiene que desactivar y volver a activar.

## 7. Programador de llamadas (secreto del cron) — se genera

```bash
openssl rand -hex 32
```

1. Cargá ese valor en Vercel como `CRON_SECRET` (Sensitive) y redesplegá.
2. En Supabase → SQL Editor, ejecutá esto **con tus valores** (la URL de la app sin barra final y el mismo secreto):

```sql
select vault.create_secret('https://miagente-mi-agente1.vercel.app', 'miagente_app_url');
select vault.create_secret('EL-MISMO-VALOR-DE-CRON_SECRET', 'miagente_cron_secret');
```

El trabajo que corre cada minuto ya está creado y funcionando en tu proyecto (lo verifiqué); mientras falten esos dos valores no hace nada. Para cambiarlos más adelante: `select vault.update_secret((select id from vault.secrets where name = 'miagente_cron_secret'), 'NUEVO-VALOR');`

**Destraba:** que las llamadas de tus rutinas se disparen y se reprogramen solas. **Cómo comprobar:** creá una rutina para dentro de 3 minutos (Configuración → Rutinas de llamada) y esperá: tiene que aparecer el aviso «Tu Agente te está llamando» en la app y, si hiciste el paso 6, la notificación. Para ver las respuestas del servidor: `select status_code, content from net._http_response order by created desc limit 5;` (200 = bien, 401 = el secreto no coincide, 503 = falta `CRON_SECRET` o la clave de servicio en Vercel).

## 8. Azure Speech — opcional

Sin esto las llamadas funcionan igual con el reconocimiento y la voz del navegador. Azure suena mejor y anda en más navegadores.

**Antes de decidir:** crear la cuenta de Azure pide una tarjeta para verificar identidad. El recurso que se usa es el nivel **F0 (gratuito)**, que no cobra y no pasa a pago solo; si no querés poner una tarjeta, salteá este paso.

1. portal.azure.com → Crear un recurso → **Speech** → plan de tarifa **Free F0**. Elegí una región (por ejemplo `brazilsouth` o `eastus`).
2. En el recurso: Keys and Endpoint → copiá **KEY 1** y la **región** (el nombre corto, sin espacios).

| Variable | Valor | Dónde |
|---|---|---|
| `AZURE_SPEECH_KEY` | KEY 1 | Vercel, Sensitive |
| `AZURE_SPEECH_REGION` | por ejemplo `brazilsouth` | Vercel |

Necesita además el paso 2. **Cómo comprobar:** Configuración → Voz → «Azure configurado» y las barras de uso del mes. En una llamada, arriba a la derecha dice «Voz: Azure».

## 9. Modelo local con Ollama — opcional

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

## 10. Después de cargar todo

- **Pasar la producción a `main`.** Vercel → Settings → Environments → Production → Branch Tracking → `main`. La rama `main` ya existe con el mismo código. No lo cambié yo para no arriesgar el despliegue en uso.
- **URL de la app en Supabase Auth.** Ya está: `site_url` y las redirecciones apuntan a `miagente-mi-agente1.vercel.app` y `miagente-zeta.vercel.app`. Si usás otro dominio, agregalo en Authentication → URL Configuration.
