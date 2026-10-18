import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  BallDontLieNhlResultsProvider,
  BdlBoxScore,
  BdlGame,
} from "../sports-providers/results/balldontlie-nhl-results-provider.ts";
import { HOCKEY_MINUTES, HOCKEY_RULES, buildHouseLines } from "./engine.ts";
import type { HouseLinesPayload, ScheduleMatch } from "./sync-house.ts";
import { syncNhlHouseLines } from "./sync-nhl-house.ts";

// Реальный протокол BALLDONTLIE: WSH — NJD, 17.10.2026 (урезан). Для формы нужны минимум
// два матча — второй получен сдвигом того же протокола на неделю раньше.
const fixtures = path.join(import.meta.dirname, "../sports-providers/results/__fixtures__");
const box = (JSON.parse(readFileSync(path.join(fixtures, "bdl-nhl-box-3328169.json"), "utf8")) as { data: BdlBoxScore[] }).data;
const earlier = box.map((b) => ({ ...b, game: { ...b.game, id: 3328000, start_time_utc: "2026-10-10T17:00:00.000Z" } }));
const played = [...box, ...earlier];
const { home_team: WSH, away_team: NJD } = box[0].game;

const NOW = new Date("2026-10-19T12:00:00Z");
const upcoming: BdlGame = { ...box[0].game, id: 3329000, start_time_utc: "2026-10-19T23:00:00.000Z", game_state: "FUT", home_score: null, away_score: null };

const bdl = {
  gamesOn: async () => [upcoming],
  teamSeasonBoxScores: async (teamId: number) => played.filter((b) => b.team.id === teamId),
} as unknown as BallDontLieNhlResultsProvider;

const schedule = (other_lines = 0): ScheduleMatch[] => [
  {
    id: "m-wsh-njd",
    starts_at: "2026-10-19T23:00:00Z",
    other_lines,
    home: { id: "team-wsh", name: "Washington Capitals", abbr: "WSH" },
    away: { id: "team-njd", name: "New Jersey Devils", abbr: "NJD" },
  },
];

function sink(matches: ScheduleMatch[]) {
  const ingested: HouseLinesPayload[] = [];
  return {
    ingested,
    scheduleMatches: async () => matches,
    ingestHouseLines: async (_source: string, payload: HouseLinesPayload) => {
      ingested.push(payload);
      return { projections: payload.matches.flatMap((m) => m.projections).length, suspended: 0 };
    },
  };
}

describe("линии PICKUP для НХЛ (BALLDONTLIE)", () => {
  it("выставляет линии игрокам обеих команд и привязывает их к командам матча расписания", async () => {
    const s = sink(schedule());
    const report = await syncNhlHouseLines(bdl, s, { now: NOW });
    expect(report).toMatchObject({ matches: 1, unmatched: 0, skipped_with_lines: 0 });
    const m = s.ingested[0].matches[0];
    expect(m.match_id).toBe("m-wsh-njd");
    const byName = Object.fromEntries(m.players.map((p) => [p.full_name, p]));
    expect(byName["Alex Ovechkin"]).toMatchObject({ team_id: "team-wsh", position: "L", external_id: "balldontlie:player:5" });
    expect(byName["Jack Hughes"]?.team_id).toBe("team-njd");
    // Вратарь, отстоявший матч, получает линию на сейвы; запасной (0:00 на льду) — нет.
    const saves = m.projections.filter((p) => p.market_code === "saves").map((p) => m.players.find((x) => x.external_id === p.player_external_id)?.full_name);
    expect(saves).toContain("Logan Thompson");
    expect(saves).not.toContain("Charlie Lindgren");
  });

  it("игрок, не выходивший в последних трёх матчах команды (обмен, травма), линий не получает", async () => {
    const shifted = (id: number, date: string, rows: BdlBoxScore[]) => rows.map((b) => ({ ...b, game: { ...b.game, id, start_time_utc: date } }));
    const withoutWilson = box.filter((b) => b.player.full_name !== "Tom Wilson");
    const history = [
      ...shifted(1, "2026-10-01T17:00:00.000Z", box),
      ...shifted(2, "2026-10-04T17:00:00.000Z", box),
      ...shifted(3, "2026-10-08T17:00:00.000Z", withoutWilson),
      ...shifted(4, "2026-10-12T17:00:00.000Z", withoutWilson),
      ...shifted(5, "2026-10-15T17:00:00.000Z", withoutWilson),
    ];
    const traded = { ...bdl, teamSeasonBoxScores: async (teamId: number) => history.filter((b) => b.team.id === teamId) } as unknown as BallDontLieNhlResultsProvider;
    const s = sink(schedule());
    await syncNhlHouseLines(traded, s, { now: NOW });
    const names = s.ingested[0].matches[0].players.map((p) => p.full_name);
    expect(names).toContain("Alex Ovechkin");
    expect(names).not.toContain("Tom Wilson");
  });

  it("свежий обмен: игрок с линиями только в матче своей новой команды", async () => {
    const PIT = { ...WSH, id: 99, full_name: "Pittsburgh Penguins", tricode: "PIT" };
    const ovi = box.filter((b) => b.player.full_name === "Alex Ovechkin");
    const at = (rows: BdlBoxScore[], id: number, date: string, team = rows[0].team) =>
      rows.map((b) => ({ ...b, team, game: { ...b.game, id, start_time_utc: date } }));
    // За «Вашингтон» — 10 и 15 октября, за «Питтсбург» — 16 и 17 октября.
    const history = [
      ...at(box, 10, "2026-10-10T17:00:00.000Z"),
      ...at(box, 15, "2026-10-15T17:00:00.000Z"),
      ...at(ovi, 16, "2026-10-16T17:00:00.000Z", PIT),
      ...at(ovi, 17, "2026-10-17T17:00:00.000Z", PIT),
      ...at(box.filter((b) => b.position === "G"), 16, "2026-10-16T17:00:00.000Z", PIT),
      ...at(box.filter((b) => b.position === "G"), 17, "2026-10-17T17:00:00.000Z", PIT),
    ];
    const pitGame: BdlGame = { ...upcoming, id: 3329001, home_team: PIT, away_team: NJD, start_time_utc: "2026-10-20T00:00:00.000Z" };
    const traded = {
      gamesOn: async () => [upcoming, pitGame],
      teamSeasonBoxScores: async (teamId: number) => history.filter((b) => b.team.id === teamId),
    } as unknown as BallDontLieNhlResultsProvider;
    const s = sink([
      ...schedule(),
      { id: "m-pit-njd", starts_at: "2026-10-20T00:00:00Z", home: { id: "team-pit", name: "Pittsburgh Penguins", abbr: "PIT" }, away: { id: "team-njd", name: "New Jersey Devils", abbr: "NJD" } },
    ]);
    await syncNhlHouseLines(traded, s, { now: NOW });
    const byMatch = Object.fromEntries(s.ingested[0].matches.map((m) => [m.match_id, m.players.map((p) => p.full_name)]));
    expect(byMatch["m-wsh-njd"]).not.toContain("Alex Ovechkin");
    expect(byMatch["m-pit-njd"]).toContain("Alex Ovechkin");
  });

  it("не дублирует матчи с линиями букмекеров", async () => {
    const s = sink(schedule(12));
    const report = await syncNhlHouseLines(bdl, s, { now: NOW });
    expect(report).toMatchObject({ matches: 0, skipped_with_lines: 1 });
    expect(s.ingested).toEqual([]);
  });

  it("лимит игроков на команду", () => {
    const forms = Array.from({ length: 30 }, (_, i) => ({
      playerExternalId: String(i),
      teamExternalId: "T",
      recent: [1, 2, 3].map(() => ({ minutes: 15, stats: { shots_on_goal: 2 + i / 10, points: 0, goals: 0, assists: 0, saves: 0 } })),
      prior: null,
    }));
    const players = new Set(buildHouseLines(forms, HOCKEY_RULES, { maxPerTeam: 20, minutes: HOCKEY_MINUTES }).map((l) => l.playerExternalId));
    expect(players.size).toBe(20);
  });
});
