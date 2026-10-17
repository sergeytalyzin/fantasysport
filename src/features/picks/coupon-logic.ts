// Логика купона на клиенте — только для удобства интерфейса.
// Окончательная проверка и расчёт выполняются в create_lineup (PostgreSQL).

import type { PhotoCredit } from "@/lib/photo-credit";
import type { PayoutRule, PickDirection, PlayType } from "@/types/domain";

export interface CouponPick {
  projectionId: string;
  playerId: string;
  matchId: string;
  direction: PickDirection;
  line: number;
  playerName: string;
  photoUrl: string | null;
  /** Источник и лицензия фото; в сохранённых ранее купонах может отсутствовать. */
  photoCredit?: PhotoCredit | null;
  teamAbbr: string | null;
  teamColor: string | null;
  opponentAbbr: string | null;
  marketName: string;
  leagueShort: string;
  startsAt: string;
}

export type ToggleResult =
  | { picks: CouponPick[]; event: "added" | "removed" | "switched" | "replaced" }
  | { picks: CouponPick[]; event: "limit" };

/**
 * Выбор «Больше/Меньше»:
 * - повторное нажатие того же исхода убирает выбор;
 * - противоположный исход той же линии заменяет выбор (обе стороны одновременно нельзя);
 * - другая линия того же спортсмена заменяет прежнюю (один спортсмен — один выбор);
 * - больше maxPicks добавить нельзя.
 */
export function togglePick(picks: CouponPick[], pick: CouponPick, maxPicks: number): ToggleResult {
  const same = picks.find((p) => p.projectionId === pick.projectionId);
  if (same) {
    if (same.direction === pick.direction) {
      return { picks: picks.filter((p) => p.projectionId !== pick.projectionId), event: "removed" };
    }
    return {
      picks: picks.map((p) => (p.projectionId === pick.projectionId ? { ...p, direction: pick.direction } : p)),
      event: "switched",
    };
  }
  const samePlayer = picks.find((p) => p.playerId === pick.playerId);
  if (samePlayer) {
    return { picks: picks.map((p) => (p.playerId === pick.playerId ? pick : p)), event: "replaced" };
  }
  if (picks.length >= maxPicks) return { picks, event: "limit" };
  return { picks: [...picks, pick], event: "added" };
}

export function findMultiplier(
  rules: PayoutRule[],
  playType: PlayType,
  picksCount: number,
  correctCount = picksCount,
): number | null {
  const rule = rules.find(
    (r) =>
      r.is_active && r.play_type === playType && r.picks_count === picksCount && r.correct_count === correctCount,
  );
  return rule ? Number(rule.multiplier) : null;
}

/** Таблица выплат Flex для текущего числа выборов (от лучшего исхода к худшему). */
export function flexTable(rules: PayoutRule[], picksCount: number) {
  return rules
    .filter((r) => r.is_active && r.play_type === "FLEX" && r.picks_count === picksCount && Number(r.multiplier) > 0)
    .sort((a, b) => b.correct_count - a.correct_count)
    .map((r) => ({ correct: r.correct_count, multiplier: Number(r.multiplier) }));
}

/** Потенциальная выплата в копейках (округление вниз, как в БД). */
export function potentialPayout(stakeRub: number, multiplier: number | null): number {
  if (!multiplier || !Number.isFinite(stakeRub) || stakeRub <= 0) return 0;
  return Math.floor(stakeRub * 100 * multiplier);
}

export function toRpcSelections(picks: CouponPick[]) {
  return picks.map((p) => ({ projection_id: p.projectionId, direction: p.direction, line: p.line }));
}
