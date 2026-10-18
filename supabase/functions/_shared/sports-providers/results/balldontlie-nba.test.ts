import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncNbaHouseLines } from "../../house-lines/sync-nba-house.ts";
import type { HouseLinesPayload, ScheduleMatch } from "../../house-lines/sync-house.ts";
import { BallDontLieNbaResultsProvider, nbaMinutes } from "./balldontlie-nba-results-provider.ts";
import { pickGame } from "./sync-results.ts";
import type { AwaitingMatch, ExternalGameResult } from "./types.ts";

// Реальные ответы api.balldontlie.io/v1, тариф ALL-STAR: BOS — PHI, 02.05.2026 (плей-офф), 100:109.
// Составы — текущие (после межсезонья).
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8");
const bdlFetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  const team = url.searchParams.get("team_ids[]");
  const file = url.pathname.endsWith("/games/21682743") ? "bdl-nba-game-21682743.json"
    : url.pathname.endsWith("/games") && url.searchParams.has("dates[]") ? "bdl-nba-games.json"
    : url.pathname.endsWith("/stats") ? "bdl-nba-stats-21682743.json"
    : url.pathname.endsWith("/players/active") && team ? `bdl-nba-active-${team}.json`
    : null;
  return file ? new Response(fixture(file), { status: 200 }) : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
}) as typeof fetch;

const match = (): AwaitingMatch => ({
  match_id: "m1",
  league_code: "NBA",
  starts_at: "2026-05-02T23:30:00Z",
  home: { name: "Boston Celtics" },
  away: { name: "Philadelphia 76ers" },
  players: [],
  link: null,
});

describe("BallDontLieNbaResultsProvider (реальные ответы API)", () => {
  const bdl = new BallDontLieNbaResultsProvider({ apiKey: "k", fetch: bdlFetch, minIntervalMs: 0 });

  it("находит матч и разбирает статистику; «00» минут и игроки вне протокола — не играли", async () => {
    expect(pickGame(match(), await bdl.findGames(match()))?.game.gameId).toBe("21682743");
    const result = (await bdl.getGameResult("21682743")) as ExternalGameResult;
    expect(result).toMatchObject({ final: true, homeScore: 100, awayScore: 109 });
    const byName = Object.fromEntries(result.players.map((p) => [p.fullName, p]));
    expect(byName["Jaylen Brown"]).toEqual({ fullName: "Jaylen Brown", didPlay: true, stats: { points: 33, rebounds: 9, assists: 4, threes_made: 3 } });
    expect(byName["Jayson Tatum"].didPlay).toBe(false);
    // В текущем составе «Филадельфии», но в том матче не играл.
    expect(byName["LeBron James"]).toMatchObject({ didPlay: false });
  });

  it("минуты: «40», «33:13», «00»", () => {
    expect(nbaMinutes("40")).toBe(40);
    expect(nbaMinutes("33:13")).toBeCloseTo(33.22, 1);
    expect(nbaMinutes("00")).toBe(0);
    expect(nbaMinutes(null)).toBe(0);
  });
});

describe("линии PICKUP для НБА", () => {
  const stats = JSON.parse(fixture("bdl-nba-stats-21682743.json")).data;
  // Форма — три матча (тот же протокол, сдвинутый по датам).
  const recent = [0, 1, 2].flatMap((i) => stats.map((r: { game: object }) => ({ ...r, game: { ...r.game, id: 100 + i, datetime: `2026-04-2${i}T23:00:00.000Z` } })));
  const active = (team: number) => JSON.parse(fixture(`bdl-nba-active-${team}.json`)).data;
  const bdl = {
    gamesOn: async () => [{ ...JSON.parse(fixture("bdl-nba-game-21682743.json")).data, id: 999, datetime: "2026-10-20T23:00:00.000Z", status: "2026-10-20T23:00:00Z", season: 2026 }],
    activeRoster: async (team: number) => active(team),
    teamRecentStats: async (team: number) => recent.filter((r: { team: { id: number } }) => r.team.id === team),
    seasonAverage: async () => ({ player_id: 0, games_played: 60, min: "30:00", pts: 18, reb: 6, ast: 5, fg3m: 2 }),
  } as unknown as BallDontLieNbaResultsProvider;
  const schedule: ScheduleMatch[] = [
    { id: "m-bos-phi", starts_at: "2026-10-20T23:00:00Z", home: { id: "t-bos", name: "Boston Celtics" }, away: { id: "t-phi", name: "Philadelphia 76ers" } },
  ];

  it("линии игрокам текущего состава; новичок — по средним прошлого сезона", async () => {
    const ingested: HouseLinesPayload[] = [];
    const report = await syncNbaHouseLines(bdl, {
      scheduleMatches: async () => schedule,
      ingestHouseLines: async (_s, p) => (ingested.push(p), { projections: p.matches[0].projections.length }),
    }, { now: new Date("2026-10-19T12:00:00Z") });
    expect(report).toMatchObject({ matches: 1, unmatched: 0 });
    const players = Object.fromEntries(ingested[0].matches[0].players.map((p) => [p.full_name, p]));
    expect(players["Derrick White"]?.team_id).toBe("t-bos");
    // Перешли в «Филадельфию» в межсезонье (Браун — из «Бостона»): матчей за неё ещё нет —
    // линии по средним прошлого сезона, команда — текущая.
    expect(players["Jaylen Brown"]?.team_id).toBe("t-phi");
    expect(players["LeBron James"]?.team_id).toBe("t-phi");
    // В том протоколе играл за «Филадельфию», но больше не в её составе — линий нет.
    const roster = new Set(active(23).map((p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`));
    for (const p of Object.values(players).filter((x) => x.team_id === "t-phi")) expect(roster.has(p.full_name)).toBe(true);
  });
});
