import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type AfFixtureLive, apiFootballSnapshot } from "./apifootball-live.ts";
import { type NhlPlayByPlay, nhlSnapshot } from "./nhl-live.ts";

const fixture = <T,>(name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8")) as T;

describe("NHL live (реальный play-by-play PIT @ COL)", () => {
  const snap = nhlSnapshot(fixture<NhlPlayByPlay>("nhl-pbp-2026020119.json"));

  it("табло и статус", () => {
    expect(snap).toMatchObject({ state: "FINAL", status: "Матч завершён", home: { score: 5, shots: 32 }, away: { score: 2, shots: 32 } });
  });

  it("голы с авторами и передачами", () => {
    const goals = snap.events.filter((e) => e.kind === "goal");
    expect(goals).toHaveLength(7);
    expect(goals.filter((g) => g.side === "home")).toHaveLength(5);
    expect(goals.every((g) => g.player && g.label.includes("период"))).toBe(true);
  });

  it("координаты нормализованы: хозяева атакуют вправо во всех периодах", () => {
    const shots = snap.events.filter((e) => e.kind === "shot" && e.x !== null);
    const avg = (side: string) => {
      const xs = shots.filter((s) => s.side === side).map((s) => s.x!);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg("home")).toBeGreaterThan(30);
    expect(avg("away")).toBeLessThan(-30);
  });

  it("удаления переведены", () => {
    const penalty = snap.events.find((e) => e.kind === "penalty");
    expect(penalty?.detail).toMatch(/мин/);
  });
});

describe("API-Football live (реальный матч Everton 0:2 Chelsea)", () => {
  const snap = apiFootballSnapshot(fixture<AfFixtureLive>("apifootball-fixture-1557430.json"));

  it("счёт, статус и события", () => {
    expect(snap).toMatchObject({ state: "FINAL", home: { score: 0 }, away: { score: 2 } });
    const goals = snap.events.filter((e) => e.kind === "goal");
    expect(goals.map((g) => [g.player, g.label, g.side])).toEqual([
      ["Pedro Neto", "46'", "away"],
      ["Pedro Neto", "90'", "away"],
    ]);
    expect(snap.events.filter((e) => e.kind === "card")).toHaveLength(7);
  });

  it("в замене показан вышедший игрок", () => {
    const sub = snap.events.find((e) => e.kind === "sub" && e.detail === "вместо: Pedro Neto");
    expect(sub).toBeDefined();
  });

  it("минута во время матча", () => {
    const live = apiFootballSnapshot({
      ...fixture<AfFixtureLive>("apifootball-fixture-1557430.json"),
      fixture: { status: { short: "2H", elapsed: 67 } },
    });
    expect(live).toMatchObject({ state: "LIVE", status: "67'" });
  });
});
