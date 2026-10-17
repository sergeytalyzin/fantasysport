import { describe, expect, it } from "vitest";
import type { PayoutRule } from "@/types/domain";
import { type CouponPick, findMultiplier, flexTable, potentialPayout, togglePick } from "./coupon-logic";

const pick = (n: number, overrides: Partial<CouponPick> = {}): CouponPick => ({
  projectionId: `proj-${n}`,
  playerId: `player-${n}`,
  matchId: "m1",
  direction: "OVER",
  line: 3.5,
  playerName: `Игрок ${n}`,
  photoUrl: null,
  teamAbbr: "AAA",
  teamColor: null,
  opponentAbbr: "BBB",
  marketName: "Очки",
  leagueShort: "НБА",
  startsAt: "2026-10-18T00:00:00Z",
  ...overrides,
});

const rules: PayoutRule[] = [
  { id: "1", play_type: "POWER", picks_count: 2, correct_count: 2, multiplier: 3, is_active: true },
  { id: "2", play_type: "POWER", picks_count: 6, correct_count: 6, multiplier: 37.5, is_active: true },
  { id: "3", play_type: "FLEX", picks_count: 5, correct_count: 5, multiplier: 10, is_active: true },
  { id: "4", play_type: "FLEX", picks_count: 5, correct_count: 4, multiplier: 2, is_active: true },
  { id: "5", play_type: "FLEX", picks_count: 5, correct_count: 3, multiplier: 0.4, is_active: true },
  { id: "6", play_type: "FLEX", picks_count: 4, correct_count: 3, multiplier: 1.5, is_active: false },
];

describe("togglePick", () => {
  it("добавляет и убирает выбор повторным нажатием", () => {
    const added = togglePick([], pick(1), 6);
    expect(added).toMatchObject({ event: "added" });
    expect(togglePick(added.picks, pick(1), 6)).toEqual({ picks: [], event: "removed" });
  });

  it("противоположный исход той же линии меняет направление, а не добавляет второй выбор", () => {
    const { picks } = togglePick([], pick(1), 6);
    const switched = togglePick(picks, pick(1, { direction: "UNDER" }), 6);
    expect(switched.event).toBe("switched");
    expect(switched.picks).toHaveLength(1);
    expect(switched.picks[0].direction).toBe("UNDER");
  });

  it("другая линия того же спортсмена заменяет прежнюю", () => {
    const { picks } = togglePick([], pick(1), 6);
    const replaced = togglePick(picks, pick(1, { projectionId: "proj-other", marketName: "Подборы" }), 6);
    expect(replaced.event).toBe("replaced");
    expect(replaced.picks.map((p) => p.projectionId)).toEqual(["proj-other"]);
  });

  it("не даёт превысить лимит", () => {
    const full = [1, 2, 3, 4, 5, 6].map((n) => pick(n));
    expect(togglePick(full, pick(7), 6)).toEqual({ picks: full, event: "limit" });
  });
});

describe("выплаты", () => {
  it("находит множитель Power и Flex", () => {
    expect(findMultiplier(rules, "POWER", 2)).toBe(3);
    expect(findMultiplier(rules, "POWER", 6)).toBe(37.5);
    expect(findMultiplier(rules, "FLEX", 5)).toBe(10);
    expect(findMultiplier(rules, "POWER", 3)).toBeNull();
  });

  it("таблица Flex без неактивных правил", () => {
    expect(flexTable(rules, 5)).toEqual([
      { correct: 5, multiplier: 10 },
      { correct: 4, multiplier: 2 },
      { correct: 3, multiplier: 0.4 },
    ]);
    expect(flexTable(rules, 4)).toEqual([]);
  });

  it("потенциальная выплата в копейках с округлением вниз", () => {
    expect(potentialPayout(1000, 37.5)).toBe(3_750_000);
    expect(potentialPayout(333, 0.4)).toBe(13_320);
    expect(potentialPayout(0, 3)).toBe(0);
    expect(potentialPayout(100, null)).toBe(0);
  });
});
