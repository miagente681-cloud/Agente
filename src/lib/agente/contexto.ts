import { diferenciaDias, etiquetaFecha, fechaLarga } from "@/lib/datos/fechas";
import type { Tarea } from "@/lib/datos/tipos";
import { cuandoLegible, partesEnZona } from "@/lib/programacion/horarios";
import { corto, type Instantanea, type Sesion } from "./datos";

/**
 * Arma lo que el modelo recibe en cada turno. Tiene que ser compacto: los
 * cupos gratuitos se miden en tokens (Groq: 8.000 por minuto), así que va un
 * resumen del estado y el detalle se pide con herramientas.
 */

const MAX_TAREAS = 40;
const MAX_MEMORIAS = 25;
/** Días en curso sin moverse a partir de los cuales una tarea se marca como estancada. */
const DIAS_ESTANCADA = 7;

const PERSONALIDAD = `Sos el Agente de MiAgente: el project manager personal de quien te habla. Hablás en español rioplatense, con voseo.
Estilo: coach directo y exigente. Marcás cuando algo se viene postergando, preguntás el porqué y no cerrás un tema sin un compromiso concreto con fecha. No adulás ni rellenás: nada de "¡excelente!" ni de repetir lo que te dijeron. Exigente no es agresivo: si aparece un problema personal serio, bajás la presión y primero entendés.
Cuando algo está trabado, indagás la causa real (falta de tiempo, no está claro el próximo paso, tarea demasiado grande, depende de otra persona, falta un recurso, falta energía o ganas) y proponés una salida concreta: dividir la tarea, definir el próximo paso mínimo, reservar un bloque de tiempo, reducir el alcance, delegar o descartarla.
Sugerís fechas límite realistas para lo que no tiene, mirando la carga actual, las rutinas y cómo le fue antes con fechas parecidas.`;

const REGLAS = `Cómo actuás:
- Aplicás los cambios vos, con las herramientas, sin pedir permiso: si te dicen que terminaron algo o que algo está trabado, lo actualizás en el momento. El usuario ve cada cambio y lo puede deshacer.
- Decí en una frase lo que cambiaste ("te dejo esto para el jueves"). No digas que hiciste algo si no usaste la herramienta.
- Nunca borrás: archivás.
- Los ids van entre corchetes en el resumen. No los menciones al usuario ni los inventes; si no encontrás algo, usá buscar_tareas.
- Si te cuentan algo duradero sobre cómo son o cómo trabajan, guardalo con guardar_memoria.
- No pidas datos que ya están en el resumen. No muestres JSON ni nombres de herramientas.`;

function modo(sesion: Sesion, voz: boolean): string {
  const corta = voz
    ? "Es una conversación de VOZ: respondé en una a tres oraciones cortas, sin listas ni símbolos, y hacé una sola pregunta por vez. Las fechas decilas como se dicen hablando (\"el jueves\")."
    : "Es un chat de texto: respondé breve y al grano; usá listas solo si ordenan.";

  if (sesion.kind === "onboarding") {
    return `${corta}
Esta es la ENTREVISTA INICIAL: todavía no conocés a esta persona. Presentate en una frase y recorré, de a un tema por vez: 1) sus áreas de vida, 2) los proyectos que tiene en curso en cada una y qué quiere lograr, 3) sus rutinas y horarios, 4) cómo le gusta trabajar, 5) qué suele frenarla. A medida que te cuenta, creá las áreas (crear_area), los proyectos con su objetivo (crear_proyecto), las primeras tareas concretas (crear_tarea) y guardá lo que aprendés (guardar_memoria). No esperes al final para guardar. Cuando tengas lo esencial, cerrá con un resumen de lo que armaste y decile que ya puede terminar la entrevista.`;
  }
  if (sesion.kind === "llamada_programada") {
    const foco = sesion.focus ? `Foco de esta llamada: ${sesion.focus}.` : "Foco: repaso general.";
    const minutos = sesion.target_minutes ? ` Duración objetivo: ${sesion.target_minutes} minutos; ajustá la profundidad a eso.` : "";
    return `${corta}
Es una LLAMADA PROGRAMADA. ${foco}${minutos}
Guion: 1) Abrí con lo que quedó comprometido la vez anterior y preguntá qué pasó con eso. 2) Recorré lo vencido, lo que vence pronto, lo bloqueado y lo estancado, de a una cosa, preguntando el estado real. 3) Donde algo está trabado, indagá la causa y proponé una salida. 4) Proponé fechas para lo que no tiene. 5) Cerrá repitiendo los compromisos y diciendo cuándo es la próxima llamada.`;
  }
  return corta;
}

function lineaTarea(t: Tarea, hoy: string, proyecto: string | undefined, ahora: Date): string {
  const partes = [`[${corto(t.id)}] ${t.title}` + (proyecto ? ` (${proyecto})` : "")];
  if (t.status !== "pendiente") partes.push(t.status === "en_curso" ? "en curso" : t.status);
  if (t.blocked_reason) partes.push(`traba: ${t.blocked_reason}`);
  if (t.due_date) {
    const dif = diferenciaDias(hoy, t.due_date);
    partes.push(dif < 0 ? `VENCIDA hace ${-dif} d` : `vence ${etiquetaFecha(t.due_date, hoy).toLowerCase()}`);
  }
  if (t.priority === 1) partes.push("P1");
  if (t.status === "en_curso") {
    const dias = Math.floor((ahora.getTime() - new Date(t.status_changed_at).getTime()) / 86_400_000);
    if (dias >= DIAS_ESTANCADA) partes.push(`sin moverse hace ${dias} d`);
  }
  return partes.join(" · ");
}

/** Orden en que conviene hablar de las tareas: vencidas, bloqueadas, estancadas, próximas. */
function peso(t: Tarea, hoy: string): number {
  if (t.due_date && t.due_date < hoy) return 0;
  if (t.status === "bloqueada") return 1;
  if (t.status === "en_curso") return 2;
  if (t.due_date) return 3 + Math.min(diferenciaDias(hoy, t.due_date), 60) / 100;
  return 5 + t.priority / 10;
}

export function armarSistema(p: {
  datos: Instantanea;
  sesion: Sesion;
  voz: boolean;
  ahora: Date;
}): string {
  const { datos, sesion, ahora } = p;
  const zona = datos.perfil.timezone;
  const local = partesEnZona(ahora, zona);
  const hoy = local.fecha;
  const bloques: string[] = [PERSONALIDAD, REGLAS, modo(sesion, p.voz)];

  bloques.push(
    `Ahora: ${fechaLarga(hoy)} de ${hoy.slice(0, 4)}, ${local.hora} (${hoy}).` +
      (datos.perfil.name ? ` La persona se llama ${datos.perfil.name}.` : ""),
  );

  if (datos.memorias.length) {
    bloques.push(
      "Lo que sabés de esta persona:\n" +
        datos.memorias
          .slice(0, MAX_MEMORIAS)
          .map((m) => `- [${corto(m.id)}] (${m.category.replaceAll("_", " ")}) ${m.content}`)
          .join("\n"),
    );
  }

  const activos = datos.proyectos.filter((x) => x.status === "activo");
  const nombreProyecto = new Map(datos.proyectos.map((x) => [x.id, x.name]));
  const areaDe = new Map(datos.areas.map((a) => [a.id, a.name]));
  if (datos.areas.length) {
    bloques.push("Áreas: " + datos.areas.map((a) => `[${corto(a.id)}] ${a.name}`).join(", "));
  }
  if (activos.length) {
    bloques.push(
      "Proyectos activos:\n" +
        activos
          .map((x) => {
            const tareas = datos.tareas.filter((t) => t.project_id === x.id && !t.parent_id);
            const abiertas = tareas.filter((t) => t.status !== "hecha").length;
            return (
              `- [${corto(x.id)}] ${x.name}` +
              (x.area_id && areaDe.get(x.area_id) ? ` (${areaDe.get(x.area_id)})` : "") +
              (x.goal ? ` — objetivo: ${x.goal.slice(0, 120)}` : "") +
              (x.due_date ? ` — vence ${etiquetaFecha(x.due_date, hoy).toLowerCase()}` : "") +
              ` — ${abiertas} abiertas, ${tareas.length - abiertas} hechas`
            );
          })
          .join("\n"),
    );
    const idsActivos = new Set(activos.map((x) => x.id));
    const abiertas = datos.tareas
      .filter((t) => idsActivos.has(t.project_id) && t.status !== "hecha")
      .sort((a, b) => peso(a, hoy) - peso(b, hoy));
    if (abiertas.length) {
      const mostradas = abiertas.slice(0, MAX_TAREAS);
      bloques.push(
        "Tareas abiertas (lo más urgente primero):\n" +
          mostradas.map((t) => "- " + lineaTarea(t, hoy, nombreProyecto.get(t.project_id), ahora)).join("\n") +
          (abiertas.length > mostradas.length
            ? `\n(y ${abiertas.length - mostradas.length} más: pedilas con ver_proyecto)`
            : ""),
      );
    }
  } else if (sesion.kind !== "onboarding") {
    bloques.push("Todavía no hay proyectos cargados. Ayudá a crear el primero.");
  }

  const pausados = datos.proyectos.filter((x) => x.status === "pausado");
  if (pausados.length) bloques.push("Proyectos pausados: " + pausados.map((x) => `[${corto(x.id)}] ${x.name}`).join(", "));

  const cerradas = datos.anteriores.filter((s) => s.status === "completada" && s.summary).slice(0, 3);
  if (cerradas.length) {
    bloques.push(
      "Sesiones anteriores (la más reciente primero):\n" +
        cerradas
          .map((s) => {
            const fecha = partesEnZona(new Date(s.ended_at ?? s.created_at), zona).fecha;
            const compromisos = (s.commitments ?? [])
              .map((c) => c.texto + (c.fecha ? ` (para ${etiquetaFecha(c.fecha, hoy).toLowerCase()})` : ""))
              .join("; ");
            return `- ${etiquetaFecha(fecha, hoy)}: ${(s.summary ?? "").slice(0, 400)}` + (compromisos ? `\n  Compromisos: ${compromisos}` : "");
          })
          .join("\n"),
    );
  }

  // Llamadas perdidas: si falta seguido a un mismo horario, hay que proponer cambiarlo.
  const perdidas = datos.anteriores.filter((s) => s.status === "perdida");
  for (const r of datos.rutinas) {
    const n = perdidas.filter((s) => s.routine_id === r.id).length;
    if (n >= 2) {
      bloques.push(
        `Faltó ${n} veces seguidas a la rutina [${corto(r.id)}] «${r.name}» (${r.local_time.slice(0, 5)}). Mencionalo y proponé cambiar el horario (actualizar_rutina).`,
      );
    }
  }
  if (perdidas.length && sesion.kind === "llamada_programada") {
    bloques.push("La llamada anterior se perdió: retomá también los temas que quedaron de esa.");
  }

  if (datos.proximas.length) {
    bloques.push(
      "Próximas llamadas: " +
        datos.proximas
          .slice(0, 3)
          .map((s) => `[${corto(s.id)}] ${cuandoLegible(new Date(s.scheduled_at as string), zona, ahora)}`)
          .join(", "),
    );
  } else if (datos.rutinas.some((r) => r.active)) {
    bloques.push("No hay otra llamada programada para hoy; la próxima sale de las rutinas.");
  }

  if (sesion.history_summary) bloques.push("Resumen de lo ya conversado en esta sesión:\n" + sesion.history_summary);
  return bloques.join("\n\n");
}
