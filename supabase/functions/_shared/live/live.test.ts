import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DemoProvider } from "../sports-providers/demo/demo-provider.ts";
import { type AfFixtureLive, apiFootballSnapshot } from "./apifootball-live.ts";
import { demoSnapshot } from "./demo-live.ts";
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

describe("демо live-симуляция", () => {
  const provider = new DemoProvider({ marketComponents: {} });
  const NOW = new Date("2026-10-17T09:00:00Z");

  async function matchOf(code: string) {
    const { matches } = await provider.getMatches({ from: NOW, to: new Date(NOW.getTime() + 2 * 86_400_000) });
    return matches.find((m) => m.leagueCode === code)!;
  }

  it("до начала — без событий, после конца — итог совпадает с расчётом", async () => {
    for (const code of ["NHL", "EPL", "NBA"]) {
      const m = await matchOf(code);
      const start = new Date(m.startsAt).getTime();
      const pre = await demoSnapshot(provider, m.externalId, new Date(start - 60_000));
      expect(pre).toMatchObject({ state: "PRE", events: [], home: { score: 0 } });

      const final = await demoSnapshot(provider, m.externalId, new Date(start + 6 * 3600_000));
      const result = await provider.getPlayerStats({ matchExternalId: m.externalId, force: true });
      expect(final).toMatchObject({ state: "FINAL", home: { score: result!.homeScore }, away: { score: result!.awayScore } });
    }
  });

  it("события появляются постепенно и не исчезают", async () => {
    const m = await matchOf("KHL");
    const start = new Date(m.startsAt).getTime();
    const early = await demoSnapshot(provider, m.externalId, new Date(start + 30 * 60_000));
    const late = await demoSnapshot(provider, m.externalId, new Date(start + 120 * 60_000));
    expect(early!.state).toBe("LIVE");
    expect(early!.events.length).toBeLessThan(late!.events.length);
    expect(late!.events.slice(0, early!.events.length).map((e) => e.label)).toEqual(early!.events.map((e) => e.label));
    expect(early!.home.score).toBeLessThanOrEqual(late!.home.score);
  });

  it("хозяева атакуют вправо, броски в створ совпадают со статистикой", async () => {
    const m = await matchOf("NHL");
    const final = (await demoSnapshot(provider, m.externalId, new Date(new Date(m.startsAt).getTime() + 6 * 3600_000)))!;
    expect(final.events.filter((e) => e.side === "home").every((e) => (e.x ?? 1) > 0)).toBe(true);
    const result = (await provider.getPlayerStats({ matchExternalId: m.externalId, force: true }))!;
    const homeIds = new Set(provider.describeMatch(m.externalId)!.home.players.map((p) => p.externalId));
    const playerSog = result.players.filter((p) => homeIds.has(p.playerExternalId)).reduce((s, p) => s + (p.stats.shots_on_goal ?? 0), 0);
    const restGoals = result.homeScore! - result.players.filter((p) => homeIds.has(p.playerExternalId)).reduce((s, p) => s + (p.stats.goals ?? 0), 0);
    expect(final.home.shots).toBe(playerSog + restGoals);
  });

  it("баскетбол — счёт и лидеры без событий", async () => {
    const m = await matchOf("NBA");
    const mid = (await demoSnapshot(provider, m.externalId, new Date(new Date(m.startsAt).getTime() + 70 * 60_000)))!;
    expect(mid).toMatchObject({ state: "LIVE", surface: "court", events: [] });
    expect(mid.status).toMatch(/четверть/);
    expect(mid.leaders.length).toBeGreaterThan(0);
  });
});
