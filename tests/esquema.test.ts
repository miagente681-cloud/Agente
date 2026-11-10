import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Aplica las migraciones en un Postgres en memoria y comprueba que RLS aísla
 * a un usuario de otro. El esquema `auth` de Supabase se simula con lo mínimo.
 */
const ANA = "11111111-1111-1111-1111-111111111111";
const BETO = "22222222-2222-2222-2222-222222222222";

const TABLAS = [
  "profiles", "areas", "projects", "tasks", "call_routines", "availability_windows",
  "sessions", "messages", "project_log", "memories", "change_log",
  "push_subscriptions", "voice_usage",
];

let db: PGlite;

async function como<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
  `);
  const dir = path.resolve(__dirname, "../supabase/migrations");
  for (const archivo of readdirSync(dir).sort()) {
    await db.exec(readFileSync(path.join(dir, archivo), "utf8"));
  }
  // Supabase da estos permisos por defecto; RLS es lo que restringe.
  await db.exec(`
    grant usage on schema public to authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    insert into auth.users (id, email) values ('${ANA}', 'ana@ejemplo.com'), ('${BETO}', 'beto@ejemplo.com');
  `);
});

describe("esquema", () => {
  it("todas las tablas tienen RLS activado", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLAS].sort());
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("crea el perfil al registrarse, con la zona horaria por defecto", async () => {
    const { rows } = await db.query<{ user_id: string; timezone: string }>(
      "select user_id, timezone from public.profiles order by user_id",
    );
    expect(rows).toEqual([
      { user_id: ANA, timezone: "America/Montevideo" },
      { user_id: BETO, timezone: "America/Montevideo" },
    ]);
  });

  it("un usuario no ve ni modifica los datos de otro", async () => {
    const tareaDeAna = await como(ANA, async () => {
      const area = await db.query<{ id: string }>(
        "insert into public.areas (name) values ('Trabajo') returning id",
      );
      const proyecto = await db.query<{ id: string }>(
        "insert into public.projects (name, area_id) values ('Lanzar sitio', $1) returning id",
        [area.rows[0].id],
      );
      const tarea = await db.query<{ id: string; user_id: string }>(
        "insert into public.tasks (title, project_id) values ('Comprar dominio', $1) returning id, user_id",
        [proyecto.rows[0].id],
      );
      expect(tarea.rows[0].user_id).toBe(ANA);
      return tarea.rows[0].id;
    });

    await como(BETO, async () => {
      for (const tabla of ["areas", "projects", "tasks"]) {
        const { rows } = await db.query(`select * from public.${tabla}`);
        expect(rows, tabla).toEqual([]);
      }
      const perfiles = await db.query<{ user_id: string }>("select user_id from public.profiles");
      expect(perfiles.rows).toEqual([{ user_id: BETO }]);

      const cambio = await db.query("update public.tasks set title = 'hackeada' where id = $1", [tareaDeAna]);
      expect(cambio.affectedRows).toBe(0);
      const borrado = await db.query("delete from public.tasks where id = $1", [tareaDeAna]);
      expect(borrado.affectedRows).toBe(0);

      // Tampoco puede crear filas a nombre de otro usuario.
      await expect(
        db.query("insert into public.areas (name, user_id) values ('Ajena', $1)", [ANA]),
      ).rejects.toThrow(/row-level security/);
    });

    await como(ANA, async () => {
      const { rows } = await db.query<{ title: string }>("select title from public.tasks");
      expect(rows).toEqual([{ title: "Comprar dominio" }]);
    });
  });

  it("el contador de voz no se puede tocar desde el navegador", async () => {
    await como(ANA, async () => {
      await expect(
        db.query("insert into public.voice_usage (user_id, month) values ($1, '2026-11-01')", [ANA]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("el uso de voz se suma de forma atómica y solo desde el servidor", async () => {
    await db.exec("set role service_role;");
    try {
      await db.query("select * from public.sumar_uso_voz($1, 30, 100)", [ANA]);
      const { rows } = await db.query<{ stt_seconds: number; tts_chars: number }>(
        "select * from public.sumar_uso_voz($1, 15, 50)",
        [ANA],
      );
      expect(rows[0]).toEqual({ stt_seconds: 45, tts_chars: 150 });
    } finally {
      await db.exec("reset role;");
    }
    await como(ANA, async () => {
      await expect(db.query("select * from public.sumar_uso_voz($1, 1, 1)", [ANA])).rejects.toThrow(
        /permission denied/,
      );
      const { rows } = await db.query<{ stt_seconds: number }>("select stt_seconds from public.voice_usage");
      expect(rows).toEqual([{ stt_seconds: 45 }]);
    });
  });

  it("mantiene las fechas de la tarea coherentes con el estado", async () => {
    await como(ANA, async () => {
      const { rows } = await db.query<{ id: string }>("select id from public.tasks limit 1");
      const id = rows[0].id;

      await db.query("update public.tasks set status = 'bloqueada', blocked_reason = 'Espero respuesta' where id = $1", [id]);
      const hecha = await db.query<{ completed_at: string | null; blocked_reason: string | null }>(
        "update public.tasks set status = 'hecha' where id = $1 returning completed_at, blocked_reason",
        [id],
      );
      expect(hecha.rows[0].completed_at).not.toBeNull();
      expect(hecha.rows[0].blocked_reason).toBeNull();

      const reabierta = await db.query<{ completed_at: string | null }>(
        "update public.tasks set status = 'en_curso' where id = $1 returning completed_at",
        [id],
      );
      expect(reabierta.rows[0].completed_at).toBeNull();
    });
  });

  it("rechaza estados que no existen", async () => {
    await como(ANA, async () => {
      await expect(
        db.query("update public.tasks set status = 'cancelada'"),
      ).rejects.toThrow(/check constraint/);
    });
  });
});
