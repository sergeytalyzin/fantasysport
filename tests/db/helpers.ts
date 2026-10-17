import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, inject } from "vitest";

// Каждый тестовый файл получает собственную БД, клонированную из шаблона с миграциями.
export function setupTestDatabase() {
  const ctx: { pool: pg.Pool } = { pool: undefined as unknown as pg.Pool };
  const dbName = `pickup_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const baseUrl = inject("pgUrl");

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: `${baseUrl}/postgres` });
    await admin.connect();
    await admin.query(`create database ${dbName} template pickup_template`);
    await admin.end();
    ctx.pool = new pg.Pool({ connectionString: `${baseUrl}/${dbName}`, max: 10 });
  });

  afterAll(async () => {
    await ctx.pool.end();
    const admin = new pg.Client({ connectionString: `${baseUrl}/postgres` });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  return ctx;
}

export type Db = pg.Pool | pg.PoolClient;

export async function createUser(
  db: Db,
  opts: { nickname?: string; createdAt?: string; admin?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data, created_at)
     values ($1, $2, $3, coalesce($4::timestamptz, now()))`,
    [id, `${id}@test.local`, { nickname: opts.nickname }, opts.createdAt ?? null],
  );
  if (opts.admin) {
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [id]);
  }
  return id;
}

// Выполняет запросы от имени пользователя так, как это делает PostgREST:
// роль authenticated и JWT-claims в настройках транзакции.
export async function asUser<T>(
  pool: pg.Pool,
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function wallet(db: Db, userId: string) {
  const { rows } = await db.query(
    `select balance::bigint as balance, reserved::bigint as reserved, capital::bigint as capital,
            funded_total::bigint as funded_total
       from public.wallets where user_id = $1`,
    [userId],
  );
  const w = rows[0];
  return {
    balance: Number(w.balance),
    reserved: Number(w.reserved),
    capital: Number(w.capital),
    fundedTotal: Number(w.funded_total),
  };
}

const RUB = 100;
export const rub = (value: number) => value * RUB;

// Тестовый матч с линиями на `playersCount` спортсменов (рынок «Очки» НБА).
export async function createMatchWithProjections(
  db: Db,
  opts: { playersCount?: number; startsInMinutes?: number; line?: number } = {},
) {
  const tag = randomUUID().slice(0, 8);
  const { rows: league } = await db.query(`select id from public.leagues where code = 'NBA'`);
  const { rows: teams } = await db.query(
    `insert into public.teams (sport_id, name, short_name, abbr, source, external_id)
     values ('basketball', 'Home ' || $1, 'Home', 'HOM', 'test', 'home-' || $1),
            ('basketball', 'Away ' || $1, 'Away', 'AWY', 'test', 'away-' || $1)
     returning id`,
    [tag],
  );
  const { rows: match } = await db.query(
    `insert into public.matches (league_id, home_team_id, away_team_id, starts_at, source, external_id)
     values ($1, $2, $3, now() + make_interval(mins => $4), 'test', 'm-' || $5)
     returning id`,
    [league[0].id, teams[0].id, teams[1].id, opts.startsInMinutes ?? 120, tag],
  );
  const { rows: market } = await db.query(
    `select id from public.markets where sport_id = 'basketball' and code = 'points'`,
  );
  const players: string[] = [];
  const projections: { id: string; line: number; playerId: string }[] = [];
  for (let i = 0; i < (opts.playersCount ?? 6); i++) {
    const { rows: player } = await db.query(
      `insert into public.players (sport_id, team_id, full_name, source, external_id)
       values ('basketball', $1, 'Игрок ' || $2, 'test', 'p-' || $3 || '-' || $2)
       returning id`,
      [teams[i % 2].id, i, tag],
    );
    players.push(player[0].id);
    const line = opts.line ?? 20.5;
    const { rows: projection } = await db.query(
      `insert into public.projections (match_id, player_id, market_id, line, source)
       values ($1, $2, $3, $4, 'test') returning id`,
      [match[0].id, player[0].id, market[0].id, line],
    );
    projections.push({ id: projection[0].id, line, playerId: player[0].id });
  }
  return { matchId: match[0].id as string, players, projections, marketId: market[0].id as string };
}

export function picks(
  projections: { id: string; line: number }[],
  direction: "OVER" | "UNDER" = "OVER",
) {
  return JSON.stringify(projections.map((p) => ({ projection_id: p.id, direction, line: p.line })));
}

export async function createLineup(
  pool: pg.Pool,
  userId: string,
  opts: {
    playType?: "POWER" | "FLEX";
    stake: number;
    selections: string;
    multiplier: number;
    key?: string;
  },
) {
  return asUser(pool, userId, async (c) => {
    const { rows } = await c.query(
      `select * from public.create_lineup($1, $2, $3::jsonb, $4, $5)`,
      [opts.playType ?? "POWER", opts.stake, opts.selections, opts.multiplier, opts.key ?? randomUUID()],
    );
    return rows[0];
  });
}

// Завершение матча с подтверждённой статистикой; points[i] — очки i-го игрока,
// null — игрок не участвовал.
export async function finishMatch(
  db: Db,
  matchId: string,
  players: string[],
  points: (number | null)[],
) {
  for (let i = 0; i < players.length; i++) {
    const value = points[i];
    if (value === undefined) continue;
    await db.query(
      `insert into public.player_statistics (match_id, player_id, stats, did_play, source)
       values ($1, $2, $3, $4, 'test')
       on conflict (match_id, player_id) do update set stats = excluded.stats, did_play = excluded.did_play`,
      [matchId, players[i], value === null ? {} : { points: value }, value !== null],
    );
  }
  await db.query(
    `update public.matches set status = 'FINISHED', results_confirmed_at = now() where id = $1`,
    [matchId],
  );
  const { rows } = await db.query(`select private.settle_match($1) as settled`, [matchId]);
  return rows[0].settled as number;
}
