import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiFootballResultsProvider } from "./apifootball-results-provider.ts";
import { NhlResultsProvider } from "./nhl-results-provider.ts";
import { pickGame, syncExternalResults } from "./sync-results.ts";
import type { AwaitingMatch, ExternalGameResult, ResultsProvider } from "./types.ts";

// Реальные (урезанные) ответы api-web.nhle.com: PIT @ COL, 17.10.2026, 2:5.
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8");
const NHL_FILES: Record<string, string> = {
  "score/2026-10-16": "nhl-score-2026-10-16.json",
  "gamecenter/2026020119/boxscore": "nhl-boxscore-2026020119.json",
  "gamecenter/2026020119/play-by-play": "nhl-pbp-2026020119.json",
  // Текущие составы (урезанные до id и имён).
  "roster/COL/current": "nhl-roster-COL.json",
  "roster/PIT/current": "nhl-roster-PIT.json",
};

const nhlFetch = (async (input: RequestInfo | URL) => {
  const key = String(input).replace("https://api-web.nhle.com/v1/", "");
  const file = NHL_FILES[key];
  return file
    ? new Response(fixture(file), { status: 200 })
    : new Response(JSON.stringify({ games: [] }), { status: 200 });
}) as typeof fetch;

const match = (overrides: Partial<AwaitingMatch> = {}): AwaitingMatch => ({
  match_id: "m1",
  league_code: "NHL",
  starts_at: "2026-10-17T01:00:00Z",
  home: { name: "Colorado Avalanche", abbr: "COL" },
  away: { name: "Pittsburgh Penguins", abbr: "PIT" },
  players: [
    { player_id: "p1", full_name: "MacKinnon, Nathan" },
    { player_id: "p2", full_name: "Artturi Lehkonen" },
    { player_id: "p3", full_name: "S. Wedgewood" },
  ],
  link: null,
  ...overrides,
});

describe("NhlResultsProvider (реальные ответы API)", () => {
  const nhl = new NhlResultsProvider({ fetch: nhlFetch });

  it("находит игру по дате и командам", async () => {
    const games = await nhl.findGames(match());
    const picked = pickGame(match(), games);
    expect(picked).toMatchObject({ game: { gameId: "2026020119" }, swapped: false });
  });

  it("находит игру, даже если хозяева и гости перепутаны", async () => {
    const swapped = match({ home: { name: "Pittsburgh Penguins" }, away: { name: "Colorado Avalanche" } });
    expect(pickGame(swapped, await nhl.findGames(swapped))).toMatchObject({ swapped: true });
  });

  it("не находит игру при большой разнице во времени", async () => {
    const late = match({ starts_at: "2026-10-17T09:00:00Z" });
    expect(pickGame(late, await nhl.findGames(late))).toBeNull();
  });

  it("извлекает статистику полевых игроков и вратарей", async () => {
    const result = (await nhl.getGameResult("2026020119")) as ExternalGameResult;
    expect(result).toMatchObject({ final: true, homeScore: 5, awayScore: 2 });
    const byName = Object.fromEntries(result.players.map((p) => [p.fullName, p]));
    expect(byName["Nathan MacKinnon"]).toEqual({
      fullName: "Nathan MacKinnon",
      didPlay: true,
      stats: { goals: 1, assists: 3, shots_on_goal: 9, saves: 0 },
    });
    expect(byName["Mackenzie Blackwood"].stats.saves).toBe(30);
    // Запасной вратарь с временем 00:00 не играл.
    expect(byName["Scott Wedgewood"].didPlay).toBe(false);
  });

  it("игроки состава, которых нет в протоколе завершённой игры, не играли", async () => {
    const result = (await nhl.getGameResult("2026020119")) as ExternalGameResult;
    const byName = Object.fromEntries(result.players.map((p) => [p.fullName, p]));
    expect(byName["Logan O'Connor"]).toMatchObject({ didPlay: false });
    expect(byName["Egor Chinakhov"]).toMatchObject({ didPlay: false });
    // Сыгравшие не дублируются.
    expect(result.players.filter((p) => p.fullName === "Nathan MacKinnon")).toHaveLength(1);
  });
});

describe("syncExternalResults", () => {
  const nhl = new NhlResultsProvider({ fetch: nhlFetch });

  function sinkWith(matches: AwaitingMatch[]) {
    const ingested: { matchId: string; provider: string; gameId: string; payload: Record<string, unknown> }[] = [];
    return {
      ingested,
      sink: {
        awaiting: async () => matches,
        ingest: async (matchId: string, provider: string, gameId: string, payload: Record<string, unknown>) => {
          ingested.push({ matchId, provider, gameId, payload });
          return {};
        },
      },
    };
  }

  it("подтверждает матч, когда сопоставлены все спортсмены", async () => {
    const { sink, ingested } = sinkWith([match()]);
    const report = await syncExternalResults([nhl], sink);
    expect(report).toMatchObject({ checked: 1, confirmed: 1, needs_review: 0 });
    expect(ingested[0]).toMatchObject({ matchId: "m1", provider: "nhl", gameId: "2026020119" });
    expect(ingested[0].payload).toMatchObject({ confirmed: true, home_score: 5, away_score: 2, unmatched: [] });
    expect(ingested[0].payload.players).toContainEqual({ player_id: "p3", did_play: false, stats: { goals: 0, assists: 0, shots_on_goal: 0, saves: 0 } });
  });

  it("при несопоставленном спортсмене сохраняет статистику без подтверждения", async () => {
    const m = match({ players: [...match().players, { player_id: "p9", full_name: "Connor McDavid" }] });
    const { sink, ingested } = sinkWith([m]);
    const report = await syncExternalResults([nhl], sink);
    expect(report).toMatchObject({ confirmed: 0, needs_review: 1 });
    expect(report.errors[0]).toContain("Connor McDavid");
    expect(ingested[0].payload).toMatchObject({ confirmed: false, unmatched: ["Connor McDavid"] });
  });

  it("меняет счёт местами, если хозяева у источников разные", async () => {
    const m = match({ home: { name: "Pittsburgh Penguins" }, away: { name: "Colorado Avalanche" } });
    const { sink, ingested } = sinkWith([m]);
    await syncExternalResults([nhl], sink);
    expect(ingested[0].payload).toMatchObject({ home_score: 2, away_score: 5 });
  });

  it("незавершённая игра — ожидание, ошибка провайдера не роняет остальные матчи", async () => {
    const flaky: ResultsProvider = {
      id: "flaky",
      leagues: ["NHL"],
      findGames: async (m) => (m.match_id === "bad" ? Promise.reject(new Error("HTTP 500")) : [{ gameId: "g", startsAt: m.starts_at, home: { names: [m.home.name] }, away: { names: [m.away.name] } }]),
      getGameResult: async () => ({ gameId: "g", final: false, homeScore: null, awayScore: null, players: [] }),
    };
    const { sink } = sinkWith([match({ match_id: "bad" }), match({ match_id: "ok" })]);
    const report = await syncExternalResults([flaky], sink);
    expect(report).toMatchObject({ checked: 2, pending: 1 });
    expect(report.errors[0]).toContain("HTTP 500");
  });
});

describe("pickGame: разные написания команд у источников", () => {
  const game = (id: string, startsAt: string, home: string, away: string) => ({ gameId: id, startsAt, home: { names: [home] }, away: { names: [away] } });
  // Реальные пары OddsPapi / API-Football (18.10.2026).
  it("то же время и одна совпавшая команда — тот же матч", () => {
    const rennes = match({ league_code: "OP_34", starts_at: "2026-10-18T15:15:00Z", home: { name: "Paris FC" }, away: { name: "Stade Rennais FC" } });
    expect(pickGame(rennes, [game("1", "2026-10-18T15:15:00+00:00", "Paris FC", "Rennes")])).toMatchObject({ game: { gameId: "1" }, swapped: false });
    const rodina = match({ league_code: "RPL", starts_at: "2026-10-19T16:30:00Z", home: { name: "Rodina Moscow" }, away: { name: "FC Orenburg" } });
    expect(pickGame(rodina, [game("2", "2026-10-19T16:30:00+00:00", "FC Orenburg", "Rodina Moskva")])).toMatchObject({ game: { gameId: "2" }, swapped: true });
  });

  it("запасное правило не срабатывает при разнице во времени и при нескольких кандидатах", () => {
    const m = match({ league_code: "OP_34", starts_at: "2026-10-18T15:15:00Z", home: { name: "Paris FC" }, away: { name: "Stade Rennais FC" } });
    expect(pickGame(m, [game("1", "2026-10-18T17:15:00+00:00", "Paris FC", "Rennes")])).toBeNull();
    expect(
      pickGame(m, [game("1", "2026-10-18T15:15:00+00:00", "Paris FC", "Rennes"), game("2", "2026-10-18T15:15:00+00:00", "Paris FC", "Lille")]),
    ).toBeNull();
  });
});

describe("ApiFootballResultsProvider", () => {
  const calls: string[] = [];
  const responses: Record<string, unknown> = {
    "fixtures?date=2026-10-18": {
      errors: [],
      response: [
        { fixture: { id: 555, date: "2026-10-18T14:00:00+00:00", status: { short: "FT" } }, league: { id: 39 }, teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } }, goals: { home: 2, away: 1 } },
        { fixture: { id: 777, date: "2026-10-18T14:00:00+00:00", status: { short: "FT" } }, league: { id: 140 }, teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } }, goals: { home: 0, away: 0 } },
      ],
    },
    "fixtures?id=555": {
      errors: [],
      response: [{ fixture: { id: 555, date: "2026-10-18T14:00:00+00:00", status: { short: "FT" } }, teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } }, goals: { home: 2, away: 1 } }],
    },
    "fixtures/players?fixture=555": {
      errors: [],
      response: [
        {
          team: { name: "Arsenal" },
          players: [
            { player: { id: 1, name: "Bukayo Saka" }, statistics: [{ games: { minutes: 90 }, shots: { total: 4, on: 2 }, goals: { total: 1 }, passes: { total: 31 } }] },
            { player: { id: 2, name: "Declan Rice" }, statistics: [{ games: { minutes: 90 }, shots: { total: null, on: null }, goals: { total: null }, passes: { total: 58 } }] },
            { player: { id: 3, name: "Bench Player" }, statistics: [{ games: { minutes: null }, shots: { total: null, on: null }, goals: { total: null }, passes: { total: null } }] },
          ],
        },
      ],
    },
  };
  const af = new ApiFootballResultsProvider({
    apiKey: "k",
    leagues: [{ code: "EPL", leagueId: "39" }],
    minIntervalMs: 0,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = String(input).replace("https://v3.football.api-sports.io/", "");
      calls.push(`${key} ${(init?.headers as Record<string, string>)["x-apisports-key"]}`);
      return new Response(JSON.stringify(responses[key] ?? { errors: { token: "bad" } }), { status: 200 });
    }) as typeof fetch,
  });

  it("находит матч только в нашей лиге и разбирает статистику; null у сыгравших — это 0", async () => {
    const m = match({ league_code: "EPL", starts_at: "2026-10-18T14:00:00Z", home: { name: "Arsenal" }, away: { name: "Chelsea" } });
    expect(pickGame(m, await af.findGames(m))?.game.gameId).toBe("555");
    const result = (await af.getGameResult("555")) as ExternalGameResult;
    expect(result.players).toEqual([
      { fullName: "Bukayo Saka", didPlay: true, stats: { goals: 1, shots: 4, shots_on_target: 2, passes: 31 } },
      { fullName: "Declan Rice", didPlay: true, stats: { goals: 0, shots: 0, shots_on_target: 0, passes: 58 } },
      { fullName: "Bench Player", didPlay: false, stats: {} },
    ]);
    expect(calls[0]).toContain(" k");
  });

  it("общий кэш матчей дня не смешивает лиги разных экземпляров провайдера", async () => {
    const store = new Map<string, unknown>();
    const cache = {
      get: async <T,>(key: string) => (store.get(key) as T) ?? null,
      set: async (key: string, value: unknown) => void store.set(key, value),
    };
    const fetchImpl = (async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(responses[String(input).replace("https://v3.football.api-sports.io/", "")]), { status: 200 })) as typeof fetch;
    const epl = new ApiFootballResultsProvider({ apiKey: "k", leagues: [{ code: "EPL", leagueId: "39" }], minIntervalMs: 0, cache, fetch: fetchImpl });
    const laliga = new ApiFootballResultsProvider({ apiKey: "k", leagues: [{ code: "OP_8", leagueId: "140" }], minIntervalMs: 0, cache, fetch: fetchImpl });
    expect((await epl.fixturesOn("2026-10-18")).map((f) => f.fixture.id)).toEqual([555]);
    expect((await laliga.fixturesOn("2026-10-18")).map((f) => f.fixture.id)).toEqual([777]);
  });

  it("ошибки в поле errors при HTTP 200 превращаются в исключение", async () => {
    await expect(af.getGameResult("999")).rejects.toThrow(/apifootball/);
  });
});
