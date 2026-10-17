import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpenDotaResultsProvider, type OpenDotaProMatch, seriesFinished } from "./opendota-results-provider.ts";
import { matchPlayers } from "./matching.ts";
import { pickGame } from "./sync-results.ts";
import type { AwaitingMatch } from "./types.ts";

// Реальная серия BO3 (OpenDota, 15.10.2026): Nix Team 2:0 zxcursed Team, команды меняются сторонами.
const dir = path.join(import.meta.dirname, "__fixtures__");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
const fetchMock = (async (input: RequestInfo | URL) => {
  const p = String(input).replace("https://api.opendota.com/api/", "");
  const file = p === "proMatches" ? "opendota-promatches.json" : `opendota-match-${p.split("/")[1]}.json`;
  return new Response(read(file), { status: 200 });
}) as typeof fetch;

const match = (overrides: Partial<AwaitingMatch> = {}): AwaitingMatch => ({
  match_id: "m",
  league_code: "DOTA2",
  starts_at: "2026-10-15T18:00:00Z",
  home: { name: "Nix Team" },
  away: { name: "zxcursed Team" },
  players: [
    { player_id: "a", full_name: "gpk~" },
    { player_id: "b", full_name: "shigetsu" },
  ],
  link: null,
  ...overrides,
});

describe("OpenDota (реальная серия)", () => {
  it("находит серию по командам и времени", async () => {
    const od = new OpenDotaResultsProvider({ fetch: fetchMock });
    expect(pickGame(match(), await od.findGames())).toMatchObject({ game: { gameId: "1155012" }, swapped: false });
  });

  it("суммирует убийства по картам и считает счёт серии по id команд", async () => {
    const od = new OpenDotaResultsProvider({ fetch: fetchMock });
    const r = (await od.getGameResult("1155012"))!;
    expect(r).toMatchObject({ final: true, homeScore: 2, awayScore: 0 });
    const { matched, unmatched } = matchPlayers(match().players, r.players);
    expect(unmatched).toEqual([]);
    // gpk~: 7 + 21, shigetsu: 4 + 11
    expect(matched.get("a")?.stats).toEqual({ kills: 28 });
    expect(matched.get("b")?.stats).toEqual({ kills: 15 });
  });

  it("серия не завершена, пока никто не набрал нужное число побед", () => {
    const map = (winner: number, series_type = 1): OpenDotaProMatch => ({
      match_id: Math.random(),
      series_id: 1,
      series_type,
      start_time: 0,
      radiant_team_id: 10,
      dire_team_id: 20,
      radiant_name: "A",
      dire_name: "B",
      radiant_win: winner === 10,
    });
    expect(seriesFinished([map(10)])).toBe(false);
    expect(seriesFinished([map(10), map(20)])).toBe(false);
    expect(seriesFinished([map(10), map(20), map(10)])).toBe(true);
    expect(seriesFinished([map(10, 0)])).toBe(true);
    expect(seriesFinished([map(10, 3), map(10, 3)])).toBe(true);
  });
});
