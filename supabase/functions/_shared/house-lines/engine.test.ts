import { describe, expect, it } from "vitest";
import { buildHouseLines, expectedPerGame, FOOTBALL_RULES, houseLine, type PlayerForm } from "./engine.ts";

const game = (minutes: number, shots: number, sot: number, passes: number, goals = 0) => ({
  minutes,
  stats: { shots, shots_on_target: sot, passes, goals },
});

const form = (id: string, team: string, recent: ReturnType<typeof game>[], prior?: PlayerForm["prior"]): PlayerForm => ({
  playerExternalId: id,
  teamExternalId: team,
  recent,
  prior: prior ?? null,
});

const KEYS = ["shots", "shots_on_target", "passes", "goals"];

describe("линии PICKUP", () => {
  it("houseLine — ближайшее x.5, при равенстве меньшее, не меньше 0,5", () => {
    expect(houseLine(2.4)).toBe(2.5);
    expect(houseLine(2.9)).toBe(2.5);
    expect(houseLine(3)).toBe(2.5);
    expect(houseLine(3.1)).toBe(3.5);
    expect(houseLine(0.3)).toBe(0.5);
    expect(houseLine(47.8)).toBe(47.5);
  });

  it("без данных или с одним матчем без прошлого сезона — линии нет", () => {
    expect(expectedPerGame(form("p", "t", []), KEYS)).toBeNull();
    expect(expectedPerGame(form("p", "t", [game(90, 3, 1, 30)]), KEYS)).toBeNull();
  });

  it("эпизоды короче 15 минут не учитываются", () => {
    const e = expectedPerGame(form("p", "t", [game(90, 4, 2, 30), game(5, 0, 0, 2), game(88, 2, 1, 40)]), KEYS)!;
    expect(e.sample).toBe(2);
    expect(e.stats.shots).toBe(3);
  });

  it("смешивает форму с прошлым сезоном, вес формы растёт с числом матчей", () => {
    const prior = { appearances: 20, minutes: 1800, totals: { shots: 20, shots_on_target: 10, passes: 600, goals: 2 } };
    const two = expectedPerGame(form("p", "t", [game(90, 4, 2, 30), game(90, 4, 2, 30)], prior), KEYS)!;
    const eight = expectedPerGame(form("p", "t", Array.from({ length: 8 }, () => game(90, 4, 2, 30)), prior), KEYS)!;
    // Прошлый сезон: 1 удар за матч; форма: 4.
    expect(two.stats.shots).toBeCloseTo(0.4 * 4 + 0.6 * 1, 5);
    expect(eight.stats.shots).toBeGreaterThan(two.stats.shots);
    expect(eight.stats.shots).toBeLessThan(4);
  });

  it("только игроки основы и не больше maxPerTeam на команду", () => {
    const forms = [
      form("bench", "A", [game(20, 1, 1, 10), game(25, 2, 1, 12)]),
      ...Array.from({ length: 7 }, (_, i) => form(`a${i}`, "A", [game(90, 1 + i, 1, 30 + i), game(90, 1 + i, 1, 30 + i)])),
      form("b1", "B", [game(90, 3, 2, 50, 1), game(80, 3, 1, 45, 0)]),
    ];
    const lines = buildHouseLines(forms, FOOTBALL_RULES, { maxPerTeam: 3 });
    const playersA = new Set(lines.filter((l) => l.playerExternalId.startsWith("a")).map((l) => l.playerExternalId));
    expect(playersA).toEqual(new Set(["a6", "a5", "a4"]));
    expect(lines.some((l) => l.playerExternalId === "bench")).toBe(false);
    expect(lines.filter((l) => l.playerExternalId === "b1")).toEqual([
      { playerExternalId: "b1", marketCode: "shots", line: 2.5 },
      { playerExternalId: "b1", marketCode: "shots_on_target", line: 1.5 },
      { playerExternalId: "b1", marketCode: "passes", line: 47.5 },
      { playerExternalId: "b1", marketCode: "goals", line: 0.5 },
    ]);
  });

  it("рынок не выставляется, если ожидание ниже порога", () => {
    const lines = buildHouseLines([form("d", "A", [game(90, 0, 0, 60), game(90, 1, 0, 55)])], FOOTBALL_RULES);
    expect(lines.map((l) => l.marketCode)).toEqual(["passes"]);
  });
});
