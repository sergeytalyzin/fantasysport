import { describe, expect, it } from "vitest";
import { DemoProvider, lineFromMean } from "./demo-provider.ts";

const marketComponents = {
  hockey: { goals: ["goals"], assists: ["assists"], points: ["goals", "assists"], shots_on_goal: ["shots_on_goal"], saves: ["saves"] },
  football: { goals: ["goals"], shots: ["shots"], shots_on_target: ["shots_on_target"], passes: ["passes"] },
  basketball: {
    points: ["points"], rebounds: ["rebounds"], assists: ["assists"], threes: ["threes_made"],
    pts_reb_ast: ["points", "rebounds", "assists"], pts_reb: ["points", "rebounds"], pts_ast: ["points", "assists"],
  },
};

const NOW = new Date("2026-10-17T09:00:00Z");
const provider = (now = NOW) => new DemoProvider({ marketComponents, now: () => now });
const range = { from: NOW, to: new Date(NOW.getTime() + 2 * 86_400_000) };

describe("DemoProvider", () => {
  it("генерирует матчи всех шести лиг в заданном диапазоне", async () => {
    const { matches, teams } = await provider().getMatches(range);
    expect(new Set(matches.map((m) => m.leagueCode))).toEqual(new Set(["KHL", "NHL", "RPL", "EPL", "UCL", "NBA"]));
    for (const m of matches) {
      expect(new Date(m.startsAt) >= range.from && new Date(m.startsAt) <= range.to).toBe(true);
      expect(m.homeTeamExternalId).not.toBe(m.awayTeamExternalId);
    }
    expect(teams.length).toBe(24);
  });

  it("детерминирован: одинаковый вход — одинаковые данные", async () => {
    const a = await provider().getMatches(range);
    const b = await provider().getMatches(range);
    expect(a).toEqual(b);
    const ids = a.matches.map((m) => m.externalId);
    expect(await provider().getPlayerProps({ matchExternalIds: ids })).toEqual(
      await provider().getPlayerProps({ matchExternalIds: ids }),
    );
  });

  it("линии только с шагом .5 и только на рынки вида спорта", async () => {
    const { matches } = await provider().getMatches(range);
    const props = await provider().getPlayerProps({ matchExternalIds: matches.map((m) => m.externalId) });
    expect(props.length).toBeGreaterThan(100);
    for (const p of props) {
      expect(p.line % 1).toBe(0.5);
      const sport = matches.find((m) => m.externalId === p.matchExternalId)!.leagueCode;
      const allowed = { KHL: "hockey", NHL: "hockey", RPL: "football", EPL: "football", UCL: "football", NBA: "basketball" }[sport];
      expect(Object.keys(marketComponents[allowed as keyof typeof marketComponents])).toContain(p.marketCode);
    }
  });

  it("результатов нет до окончания матча, а force досрочно завершает его", async () => {
    const { matches } = await provider().getMatches(range);
    const id = matches[0].externalId;
    expect(await provider().getPlayerStats({ matchExternalId: id })).toBeNull();
    const forced = await provider().getPlayerStats({ matchExternalId: id, force: true });
    expect(forced).toMatchObject({ status: "FINISHED", confirmed: true });
    expect(forced!.players).toHaveLength(8);

    const later = provider(new Date(NOW.getTime() + 5 * 86_400_000));
    expect(await later.getPlayerStats({ matchExternalId: id })).toEqual(forced);
  });

  it("статистика непротиворечива: голы ≤ броски в створ ≤ удары", async () => {
    const { matches } = await provider().getMatches(range);
    for (const m of matches.filter((x) => ["RPL", "EPL", "UCL"].includes(x.leagueCode))) {
      const r = await provider().getPlayerStats({ matchExternalId: m.externalId, force: true });
      for (const p of r!.players.filter((x) => x.didPlay)) {
        expect(p.stats.goals).toBeLessThanOrEqual(p.stats.shots_on_target);
        expect(p.stats.shots_on_target).toBeLessThanOrEqual(p.stats.shots);
      }
    }
  });

  it("неизвестный матч → null", async () => {
    expect(await provider().getPlayerStats({ matchExternalId: "demo:XXX:20260101:0", force: true })).toBeNull();
    expect(await provider().getPlayerStats({ matchExternalId: "garbage", force: true })).toBeNull();
  });

  it("lineFromMean всегда даёт x.5 и не меньше 0,5", () => {
    const rng = () => 0.5;
    expect(lineFromMean(0.3, rng)).toBe(0.5);
    expect(lineFromMean(3.2, rng)).toBe(3.5);
    expect(lineFromMean(27.8, () => 0.1)).toBe(26.5);
    expect(lineFromMean(27.8, () => 0.9)).toBe(28.5);
  });
});
