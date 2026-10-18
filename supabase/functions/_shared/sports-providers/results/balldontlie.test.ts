import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BallDontLieNhlResultsProvider } from "./balldontlie-nhl-results-provider.ts";
import { pickGame } from "./sync-results.ts";
import type { AwaitingMatch, ExternalGameResult } from "./types.ts";

// Реальные (урезанные) ответы api.balldontlie.io/nhl/v1, тариф ALL-STAR: WSH — NJD, 17.10.2026, 4:2.
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8");
const calls: string[] = [];
const bdlFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  calls.push(`${url.pathname} ${(init?.headers as Record<string, string>).Authorization}`);
  const team = url.searchParams.get("team_ids[]");
  const file =
    url.pathname.endsWith("/games") ? "bdl-nhl-games.json"
    : url.pathname.endsWith("/box_scores") ? "bdl-nhl-box-3328169.json"
    : url.pathname.endsWith("/players") && team ? `bdl-nhl-roster-${team}.json`
    : null;
  return file ? new Response(fixture(file), { status: 200 }) : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
}) as typeof fetch;

const match = (overrides: Partial<AwaitingMatch> = {}): AwaitingMatch => ({
  match_id: "m1",
  league_code: "NHL",
  starts_at: "2026-10-17T17:00:00Z",
  home: { name: "Washington Capitals", abbr: "WSH" },
  away: { name: "New Jersey Devils", abbr: "NJD" },
  players: [],
  link: null,
  ...overrides,
});

describe("BallDontLieNhlResultsProvider (реальные ответы API)", () => {
  const bdl = new BallDontLieNhlResultsProvider({ apiKey: "key-1", fetch: bdlFetch });

  it("находит матч по командам и времени, ключ передаётся в заголовке Authorization", async () => {
    expect(pickGame(match(), await bdl.findGames(match()))).toMatchObject({ game: { gameId: "3328169" }, swapped: false });
    expect(calls[0]).toContain(" key-1");
  });

  it("статистика полевых игроков и вратарей; запасной вратарь и игроки вне протокола не играли", async () => {
    const result = (await bdl.getGameResult("3328169")) as ExternalGameResult;
    expect(result).toMatchObject({ gameId: "3328169", final: true, homeScore: 4, awayScore: 2 });
    const byName = Object.fromEntries(result.players.map((p) => [p.fullName, p]));
    expect(byName["Dylan Strome"]).toEqual({ fullName: "Dylan Strome", didPlay: true, stats: expect.objectContaining({ goals: 1 }) });
    expect(byName["Logan Thompson"]).toMatchObject({ didPlay: true, stats: { saves: 29 } });
    // Время на льду 00:00 — не играл.
    expect(byName["Charlie Lindgren"].didPlay).toBe(false);
    // Есть в составе команды, но нет в протоколе матча.
    expect(byName["Justin Holl"]).toMatchObject({ didPlay: false });
    expect(result.players.filter((p) => p.fullName === "Alex Ovechkin")).toHaveLength(1);
  });

  it("без ключа провайдер не создаётся", () => {
    expect(() => new BallDontLieNhlResultsProvider({ apiKey: "" })).toThrow(/BALLDONTLIE_API_KEY/);
  });
});
