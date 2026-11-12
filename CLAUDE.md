# MiAgente: instrucciones para Claude Code

Gestor de proyectos personal (Next.js 16 + Supabase) con un Agente de IA que chatea, habla y llama. **Antes de tocar código, leé `ARQUITECTURA.md`**: explica cómo funciona todo y tiene una tabla de «dónde tocar» para cada tipo de cambio.

Documentos:

- `ARQUITECTURA.md`: mapa del proyecto, flujo del Agente, datos, seguridad, recetas.
- `DECISIONES.md`: por qué se hizo cada cosa. **Anotá ahí cada decisión que tomes por tu cuenta.**
- `CREDENCIALES.md` y `.env.example`: variables de entorno. **Actualizalos si sumás o cambiás una.**
- `AGENTS.md`: aviso sobre Next.js 16 (leer `node_modules/next/dist/docs/` antes de escribir código de Next).

## Reglas del proyecto

- **Idioma:** todo en español rioplatense: código (nombres de funciones y variables), comentarios, textos de la app, commits y documentos.
- **Costo:** todo gratuito salvo Claude, que tiene tope. No activar facturación en ningún otro proveedor.
- **Claves:** solo en variables de entorno del servidor. Nunca en el código ni en el navegador. No pedirle a la persona que pegue una clave en el chat.
- **Seguridad:** nada que proteja plata o cupos puede depender de datos que el usuario puede escribir desde el navegador (ver sección 10 de `ARQUITECTURA.md`).
- **Degradación:** una integración sin su clave muestra «falta configurar»; nunca rompe la app.
- **Base de datos:** cada cambio va en una migración nueva en `supabase/migrations/`. No editar las ya aplicadas. No borrar datos.
- **Audio:** no generar audios con ElevenLabs para esta app.

## Antes de subir un cambio

Tienen que pasar los cuatro:

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm run recorrida
```

`npm run recorrida` compila y recorre la app en un navegador con servicios de mentira; tarda unos minutos y deja capturas en `tests/recorrida/capturas/` (no se suben: borrarlas).

## Despliegue

Un `git push` a la rama `claude/pensive-galileo-w7i9nk` despliega **producción** en Vercel: no hay entorno de pruebas. Las migraciones se aplican aparte en Supabase.

Al terminar un cambio, decile a la persona qué quedó probado con servicios reales y qué solo con imitaciones.
