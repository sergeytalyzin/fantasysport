import { describe, expect, it } from "vitest";
import { type ExternalResultsSink, syncExternalResults } from "../../supabase/functions/_shared/sports-providers/results/sync-results.ts";
import type { AwaitingMatch, ResultsProvider } from "../../supabase/functions/_shared/sports-providers/results/types.ts";
import { asUser, createLineup, createUser, picks, rub, setupTestDatabase, wallet } from "./helpers";

const db = setupTestDatabase();

const sink: ExternalResultsSink = {
  async awaiting(leagueCodes, limit) {
    const { rows } = await db.pool.query(`select * from public.matches_awaiting_external_results($1, 0, $2)`, [leagueCodes, limit]);
    return rows as AwaitingMatch[];
  },
  async ingest(matchId, provider, gameId, payload) {
    const { rows } = await db.pool.query(`select public.ingest_match_stats($1, $2, $3, $4::jsonb) as r`, [
      matchId,
      provider,
      gameId,
      JSON.stringify(payload),
    ]);
    return rows[0].r;
  },
};

// Матч НХЛ, линии на который пришли «от OddsPapi» (source = 'oddspapi').
async function oddspapiMatch(players: string[]) {
  const { rows: league } = await db.pool.query(`select id from public.leagues where code = 'NHL'`);
  const { rows: teams } = await db.pool.query(
    `insert into public.teams (sport_id, name, short_name, abbr, source, external_id) values
       ('hockey', 'Colorado Avalanche', 'Colorado', 'COL', 'oddspapi', 'oddspapi:participant:col-' || gen_random_uuid()),
       ('hockey', 'Pittsburgh Penguins', 'Pittsburgh', 'PIT', 'oddspapi', 'oddspapi:participant:pit-' || gen_random_uuid())
     returning id`,
  );
  const { rows: match } = await db.pool.query(
    `insert into public.matches (league_id, home_team_id, away_team_id, starts_at, source, external_id)
     values ($1, $2, $3, now() + interval '1 hour', 'oddspapi', 'fx-' || gen_random_uuid()) returning id`,
    [league[0].id, teams[0].id, teams[1].id],
  );
  const { rows: market } = await db.pool.query(`select id from public.markets where sport_id = 'hockey' and code = 'shots_on_goal'`);
  const projections = [];
  for (const name of players) {
    const { rows: pl } = await db.pool.query(
      `insert into public.players (sport_id, full_name, source, external_id) values ('hockey', $1, 'oddspapi', 'op-' || gen_random_uuid()) returning id`,
      [name],
    );
    const { rows: pr } = await db.pool.query(
      `insert into public.projections (match_id, player_id, market_id, line, source) values ($1, $2, $3, 3.5, 'oddspapi') returning id`,
      [match[0].id, pl[0].id, market[0].id],
    );
    projections.push({ id: pr[0].id as string, line: 3.5 });
  }
  return { matchId: match[0].id as string, projections };
}

// Игра провайдера с фиксированной статистикой.
function provider(sog: Record<string, number>, gameId = "2026020119"): ResultsProvider {
  return {
    id: "nhl",
    leagues: ["NHL"],
    findGames: async (m) => [
      { gameId, startsAt: m.starts_at, home: { names: ["Avalanche"], abbr: "COL" }, away: { names: ["Penguins"], abbr: "PIT" } },
    ],
    getGameResult: async () => ({
      gameId,
      final: true,
      homeScore: 5,
      awayScore: 2,
      players: Object.entries(sog).map(([fullName, shots]) => ({
        fullName,
        didPlay: true,
        stats: { goals: 0, assists: 0, shots_on_goal: shots, saves: 0 },
      })),
    }),
  };
}

async function startMatch(matchId: string) {
  await db.pool.query(`update public.matches set starts_at = now() - interval '3 hours' where id = $1`, [matchId]);
}

describe("внешние результаты", () => {
  it("сопоставляет игроков, подтверждает матч и рассчитывает купон", async () => {
    const user = await createUser(db.pool);
    const m = await oddspapiMatch(["MacKinnon, Nathan", "Lehkonen, Artturi"]);
    const lineup = await createLineup(db.pool, user, { stake: rub(1_000), selections: picks(m.projections), multiplier: 3 });
    // Команда спортсмена неизвестна — снимок показывает сам матч.
    const { rows: snap } = await db.pool.query(
      `select distinct team_abbr, opponent_abbr from public.lineup_selections where lineup_id = $1`,
      [lineup.id],
    );
    expect(snap).toEqual([{ team_abbr: "COL", opponent_abbr: "PIT" }]);
    await startMatch(m.matchId);

    const report = await syncExternalResults([provider({ "Nathan MacKinnon": 9, "Artturi Lehkonen": 4 })], sink);
    expect(report).toMatchObject({ checked: 1, confirmed: 1 });

    const { rows } = await db.pool.query(
      `select m.status, m.home_score, m.results_confirmed_at is not null as confirmed, k.provider, k.external_game_id, k.matched_players
         from public.matches m join public.match_result_links k on k.match_id = m.id where m.id = $1`,
      [m.matchId],
    );
    expect(rows[0]).toEqual({ status: "FINISHED", home_score: 5, confirmed: true, provider: "nhl", external_game_id: "2026020119", matched_players: 2 });
    const { rows: l } = await db.pool.query(`select status from public.lineups where id = $1`, [lineup.id]);
    expect(l[0].status).toBe("WON");
    expect((await wallet(db.pool, user)).balance).toBe(rub(102_000));

    // Подтверждённый матч больше не запрашивается и не меняется.
    expect((await syncExternalResults([provider({})], sink)).checked).toBe(0);
  });

  it("несопоставленный спортсмен — статистика сохранена, матч ждёт администратора", async () => {
    const user = await createUser(db.pool);
    const admin = await createUser(db.pool, { admin: true });
    const m = await oddspapiMatch(["Nathan MacKinnon", "Unknown Rookie"]);
    const lineup = await createLineup(db.pool, user, { stake: rub(1_000), selections: picks(m.projections), multiplier: 3 });
    await startMatch(m.matchId);

    const report = await syncExternalResults([provider({ "Nathan MacKinnon": 9 }, "2026020120")], sink);
    expect(report).toMatchObject({ confirmed: 0, needs_review: 1 });

    const { rows } = await db.pool.query(
      `select m.results_confirmed_at, k.unmatched_players from public.matches m
         join public.match_result_links k on k.match_id = m.id where m.id = $1`,
      [m.matchId],
    );
    expect(rows[0]).toEqual({ results_confirmed_at: null, unmatched_players: ["Unknown Rookie"] });
    expect(report.errors).toEqual([expect.stringContaining("Unknown Rookie")]);
    expect((await db.pool.query(`select status from public.lineups where id = $1`, [lineup.id])).rows[0].status).toBe("PENDING");

    // Повторный проход использует сохранённую связь и не ломает ручной ввод.
    const { rows: rookie } = await db.pool.query(`select id from public.players where full_name = 'Unknown Rookie'`);
    await asUser(db.pool, admin, async (c) => {
      await c.query(`select public.admin_upsert_player_stats($1, $2, '{}'::jsonb, false)`, [m.matchId, rookie[0].id]);
    });
    await syncExternalResults([provider({ "Nathan MacKinnon": 9 }, "2026020120")], sink);
    const { rows: stat } = await db.pool.query(
      `select did_play, source from public.player_statistics where match_id = $1 and player_id = $2`,
      [m.matchId, rookie[0].id],
    );
    expect(stat[0]).toEqual({ did_play: false, source: "manual" });

    await asUser(db.pool, admin, (c) => c.query(`select public.admin_confirm_match_results($1)`, [m.matchId]));
    // Неучастие аннулирует выбор → купон из 1 действительного выбора возвращается.
    expect((await db.pool.query(`select status from public.lineups where id = $1`, [lineup.id])).rows[0].status).toBe("VOID");
  });

  it("недоступно клиентам", async () => {
    const user = await createUser(db.pool);
    await expect(
      asUser(db.pool, user, (c) => c.query(`select * from public.matches_awaiting_external_results(array['NHL'])`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db.pool, user, (c) => c.query(`select * from public.match_result_links`)).then((r) => r.rows),
    ).resolves.toEqual([]);
  });
});
