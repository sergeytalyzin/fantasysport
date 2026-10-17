import { describe, expect, it } from "vitest";
import type { StatLine } from "../../supabase/functions/_shared/house-lines/engine.ts";
import { type HouseSink, syncHouseLines } from "../../supabase/functions/_shared/house-lines/sync-house.ts";
import { ApiFootballResultsProvider } from "../../supabase/functions/_shared/sports-providers/results/apifootball-results-provider.ts";
import { type ExternalResultsSink, syncExternalResults } from "../../supabase/functions/_shared/sports-providers/results/sync-results.ts";
import type { AwaitingMatch } from "../../supabase/functions/_shared/sports-providers/results/types.ts";
import { createLineup, createUser, rub, setupTestDatabase, wallet } from "./helpers";

const db = setupTestDatabase();

const NOW = new Date();
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
let kickoff = new Date(NOW.getTime() + 3 * 3600_000).toISOString();

// Ответы API-Football в реальной структуре (проверено probe-скриптами).
const fx = (id: number, date: string, status: string, goals: [number | null, number | null] = [null, null]) => ({
  fixture: { id, date, status: { short: status } },
  league: { id: 235 },
  teams: { home: { id: 10, name: "Zenit" }, away: { id: 20, name: "Spartak Moscow" } },
  goals: { home: goals[0], away: goals[1] },
});
const line = (id: number, name: string, minutes: number, shots: number, on: number, passes: number, goals = 0) => ({
  player: { id, name },
  statistics: [{ games: { minutes }, shots: { total: shots, on }, goals: { total: goals }, passes: { total: passes } }],
});
const season = (id: number, name: string, apps: number, minutes: number, shots: number, on: number, passes: number, goals: number) => ({
  player: { id, name },
  statistics: [{ league: { id: 235 }, games: { appearences: apps, minutes }, shots: { total: shots, on }, goals: { total: goals }, passes: { total: passes } }],
});

let resultReady = false;
const routes = (): Record<string, unknown> => ({
  [`fixtures?date=${day(-1)}`]: [fx(900, `${day(-1)}T16:00:00+00:00`, "FT", [2, 1]), { ...fx(950, `${day(-1)}T16:00:00+00:00`, "FT"), league: { id: 39 } }],
  [`fixtures?date=${kickoff.slice(0, 10)}`]: [fx(901, kickoff, resultReady ? "FT" : "NS", resultReady ? [1, 0] : [null, null])],
  ...(kickoff.slice(0, 10) === day(0) ? {} : { [`fixtures?date=${day(0)}`]: [] }),
  [`fixtures?date=${day(1)}`]: [],
  "fixtures/players?fixture=900": [
    { team: { id: 10, name: "Zenit" }, players: [line(101, "M. Gromov", 90, 4, 2, 35, 1), line(102, "O. Belov", 90, 1, 0, 60), line(103, "Y. Titov", 10, 0, 0, 5)] },
    { team: { id: 20, name: "Spartak Moscow" }, players: [line(201, "D. Ryabov", 90, 3, 1, 30), line(202, "V. Kotov", 85, 0, 0, 55)] },
  ],
  "players?team=10&season=2024&page=1": {
    paging: { current: 1, total: 1 },
    response: [season(101, "M. Gromov", 25, 2100, 75, 30, 800, 10), season(102, "O. Belov", 28, 2500, 14, 4, 1650, 0)],
  },
  "players?team=20&season=2024&page=1": {
    paging: { current: 1, total: 1 },
    response: [
      season(201, "D. Ryabov", 20, 1700, 50, 20, 600, 6),
      season(202, "V. Kotov", 22, 1900, 6, 2, 1210, 0),
      season(301, "S. Bench", 10, 300, 5, 2, 90, 0),
    ],
  },
  "players/squads?team=10": [{ players: [
    { id: 101, name: "M. Gromov", position: "Attacker", number: 9 },
    { id: 102, name: "O. Belov", position: "Midfielder", number: 8 },
    { id: 103, name: "Y. Titov", position: "Defender", number: 4 },
    { id: 199, name: "K. Keeper", position: "Goalkeeper", number: 1 },
  ] }],
  "players/squads?team=20": [{ players: [
    { id: 201, name: "D. Ryabov", position: "Attacker", number: 10 },
    { id: 202, name: "V. Kotov", position: "Midfielder", number: 6 },
    { id: 301, name: "S. Bench", position: "Midfielder", number: 21 },
  ] }],
  "fixtures?id=901": [fx(901, kickoff, "FT", [1, 0])],
  "fixtures/players?fixture=901": [
    { team: { id: 10, name: "Zenit" }, players: [line(101, "M. Gromov", 90, 5, 3, 30, 1), line(102, "O. Belov", 90, 0, 0, 70)] },
    { team: { id: 20, name: "Spartak Moscow" }, players: [line(201, "D. Ryabov", 90, 1, 0, 25), line(202, "V. Kotov", 90, 0, 0, 40)] },
  ],
});

const calls: string[] = [];
const store = new Map<string, unknown>();
const af = new ApiFootballResultsProvider({
  apiKey: "k",
  leagues: [{ code: "RPL", leagueId: "235" }],
  minIntervalMs: 0,
  cache: {
    get: async <T,>(key: string) => (store.get(key) as T) ?? null,
    set: async (key, value) => void store.set(key, value),
  },
  fetch: (async (input: RequestInfo | URL) => {
    const key = String(input).replace("https://v3.football.api-sports.io/", "");
    calls.push(key);
    const body = routes()[key];
    if (body === undefined) return new Response(JSON.stringify({ errors: { route: key } }), { status: 200 });
    return new Response(JSON.stringify(Array.isArray(body) ? { errors: [], response: body } : { errors: [], ...body }), { status: 200 });
  }) as typeof fetch,
});

const sink: HouseSink = {
  async knownFixtures(provider, ids) {
    const { rows } = await db.pool.query(
      `select distinct fixture_external_id from public.stat_history where provider = $1 and fixture_external_id = any($2)`,
      [provider, ids],
    );
    return new Set(rows.map((r) => r.fixture_external_id));
  },
  async saveHistory(rows) {
    for (const r of rows) {
      await db.pool.query(
        `insert into public.stat_history (provider, league_code, player_external_id, player_name, team_external_id, fixture_external_id, played_at, minutes, stats)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
        [r.provider, r.league_code, r.player_external_id, r.player_name, r.team_external_id, r.fixture_external_id, r.played_at, r.minutes, r.stats],
      );
    }
  },
  async savePriors(rows) {
    for (const r of rows) {
      await db.pool.query(
        `insert into public.stat_priors (provider, league_code, season, player_external_id, player_name, appearances, minutes, totals)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (provider, season, player_external_id) do update set appearances = excluded.appearances, minutes = excluded.minutes, totals = excluded.totals`,
        [r.provider, r.league_code, r.season, r.player_external_id, r.player_name, r.appearances, r.minutes, r.totals],
      );
    }
  },
  async loadForms(provider, season, ids) {
    const h = await db.pool.query(
      `select player_external_id, minutes, stats from public.stat_history where provider = $1 and player_external_id = any($2) order by played_at desc`,
      [provider, ids],
    );
    const p = await db.pool.query(
      `select player_external_id, appearances, minutes, totals from public.stat_priors where provider = $1 and season = $2 and player_external_id = any($3)`,
      [provider, season, ids],
    );
    const history = new Map<string, StatLine[]>();
    for (const r of h.rows) history.set(r.player_external_id, [...(history.get(r.player_external_id) ?? []), { minutes: r.minutes, stats: r.stats }]);
    return { history, priors: new Map(p.rows.map((r) => [r.player_external_id, { appearances: r.appearances, minutes: r.minutes, totals: r.totals }])) };
  },
  async getProgress(key) {
    return (store.get(key) as { nextPage: number; totalPages: number | null }) ?? null;
  },
  async setProgress(key, value) {
    store.set(key, value);
  },
  async ingestSlate(source, payload) {
    const { rows } = await db.pool.query(`select public.ingest_slate($1, $2::jsonb) as r`, [source, JSON.stringify(payload)]);
    return rows[0].r;
  },
};

const resultsSink: ExternalResultsSink = {
  async awaiting(codes, limit, sports) {
    const { rows } = await db.pool.query(`select * from public.matches_awaiting_external_results($1, 0, $2, $3)`, [codes, limit, sports]);
    return rows as AwaitingMatch[];
  },
  async ingest(matchId, provider, gameId, payload) {
    const { rows } = await db.pool.query(`select public.ingest_match_stats($1, $2, $3, $4::jsonb) as r`, [matchId, provider, gameId, JSON.stringify(payload)]);
    return rows[0].r;
  },
};

describe("линии PICKUP для РПЛ", () => {
  it("копит историю, грузит прошлый сезон и выставляет линии игрокам основы", async () => {
    const report = await syncHouseLines(af, sink, { leagueCode: "RPL", leagueId: "235", now: NOW });
    expect(report).toMatchObject({ history_fixtures: 1, history_rows: 5, prior_pages: 2, matches: 1, prior_errors: [] });
    expect(report.projections).toBeGreaterThan(0);
    expect(report.complete).toBe(true);

    const { rows } = await db.pool.query(
      `select pl.full_name, mk.code, p.line::float as line, m.source
         from public.projections p
         join public.players pl on pl.id = p.player_id
         join public.markets mk on mk.id = p.market_id
         join public.matches m on m.id = p.match_id
        order by pl.full_name, mk.code`,
    );
    const names = new Set(rows.map((r) => r.full_name));
    // Запасной (300 минут за сезон) и вратарь линий не получают.
    expect(names.has("S. Bench")).toBe(false);
    expect(names.has("K. Keeper")).toBe(false);
    expect(rows.every((r) => r.source === "pickup")).toBe(true);
    // Громов: 0,25 × 4 (форма, 1 матч) + 0,75 × 3,0 (сезон) = 3,25 → ближайшее x,5 = 3,5.
    expect(rows.find((r) => r.full_name === "M. Gromov" && r.code === "shots")?.line).toBe(3.5);
    // Белов: 0,25 × 60 + 0,75 × 1650/28 ≈ 59,2 → 59,5.
    expect(rows.find((r) => r.full_name === "O. Belov" && r.code === "passes")?.line).toBe(59.5);
  });

  it("при исчерпании времени останавливается и сообщает об этом", async () => {
    const report = await syncHouseLines(af, sink, { leagueCode: "RPL", leagueId: "235", now: NOW, deadline: Date.now() - 1 });
    expect(report).toMatchObject({ complete: false, matches: 0 });
  });

  it("повторный запуск не дублирует историю, сезон и линии", async () => {
    const before = calls.length;
    const report = await syncHouseLines(af, sink, { leagueCode: "RPL", leagueId: "235", now: NOW });
    expect(report).toMatchObject({ history_fixtures: 0, prior_pages: 0, projections: 0 });
    // Только кэш: ни одного нового запроса к API.
    expect(calls.length).toBe(before);
  });

  it("купон на линии PICKUP рассчитывается по результатам API-Football", async () => {
    const user = await createUser(db.pool);
    const { rows } = await db.pool.query(
      `select p.id, p.line::float as line, pl.full_name, mk.code from public.projections p
         join public.players pl on pl.id = p.player_id join public.markets mk on mk.id = p.market_id
        where (pl.full_name, mk.code) in (('M. Gromov', 'shots'), ('O. Belov', 'passes'))`,
    );
    const lineup = await createLineup(db.pool, user, {
      stake: rub(1_000),
      selections: JSON.stringify(rows.map((r) => ({ projection_id: r.id, direction: "OVER", line: r.line }))),
      multiplier: 3,
    });

    // Матч начался минуту назад — и в базе, и у провайдера.
    kickoff = new Date(Date.now() - 60_000).toISOString();
    await db.pool.query(`update public.matches set starts_at = $1 where source = 'pickup'`, [kickoff]);
    resultReady = true;
    store.delete(`apifootball:fixtures:${kickoff.slice(0, 10)}`);
    const report = await syncExternalResults([af], resultsSink);
    expect(report).toMatchObject({ confirmed: 1 });

    // Громов 5 ударов > 3,5; Белов 70 передач > 59,5.
    expect((await db.pool.query(`select status from public.lineups where id = $1`, [lineup.id])).rows[0].status).toBe("WON");
    expect((await wallet(db.pool, user)).balance).toBe(rub(102_000));
  });
});
