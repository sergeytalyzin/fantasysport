// Генератор собственных линий PICKUP по статистике игроков.
//
// Ожидаемое значение показателя за матч = смесь свежей формы (последние матчи,
// где игрок провёл на поле хотя бы 15 минут) и итогов прошлого сезона. Вес формы
// растёт с числом сыгранных матчей: n / (n + PRIOR_WEIGHT). Линия — ближайшее
// к ожиданию значение x.5 (при равенстве — меньшее), так что «Больше» и «Меньше»
// примерно равновероятны, а ровно попасть в линию нельзя.
// Линии выставляются только игрокам основы (в среднем от 60 минут за матч).

export interface StatLine {
  minutes: number;
  stats: Record<string, number>;
}

export interface PlayerForm {
  playerExternalId: string;
  teamExternalId: string;
  /** Новые первыми. */
  recent: StatLine[];
  prior?: { appearances: number; minutes: number; totals: Record<string, number> } | null;
}

export interface HouseMarketRule {
  /** Код рынка в БД. */
  code: string;
  /** Ключ статистики. */
  stat: string;
  /** Минимальное ожидание, чтобы линия имела смысл. */
  minMean: number;
}

/** Футбол: рынки, которые бесплатно отдаёт API-Football (проверено на реальных матчах). */
export const FOOTBALL_RULES: HouseMarketRule[] = [
  { code: "shots", stat: "shots", minMean: 0.9 },
  { code: "shots_on_target", stat: "shots_on_target", minMean: 0.6 },
  { code: "passes", stat: "passes", minMean: 20 },
  { code: "goals", stat: "goals", minMean: 0.3 },
];

const PRIOR_WEIGHT = 3;
const MAX_RECENT = 8;
const MIN_RECENT_MINUTES = 15;
const MIN_EXPECTED_MINUTES = 60;
const MIN_RECENT_GAMES = 2;
const MIN_PRIOR_GAMES = 8;

export interface Expectation {
  minutes: number;
  stats: Record<string, number>;
  /** Число свежих матчей в оценке. */
  sample: number;
}

/** Ожидаемые значения за матч или null, если данных недостаточно. */
export function expectedPerGame(form: PlayerForm, statKeys: string[]): Expectation | null {
  const recent = form.recent.filter((r) => r.minutes >= MIN_RECENT_MINUTES).slice(0, MAX_RECENT);
  const n = recent.length;
  const prior = form.prior && form.prior.appearances >= MIN_PRIOR_GAMES ? form.prior : null;
  if (n < MIN_RECENT_GAMES && !prior) return null;

  const recentWeight = prior ? n / (n + PRIOR_WEIGHT) : 1;
  const avg = (key: string) => (n ? recent.reduce((s, r) => s + (r.stats[key] ?? 0), 0) / n : 0);
  const priorAvg = (key: string) => (prior ? (prior.totals[key] ?? 0) / prior.appearances : 0);
  const blend = (r: number, p: number) => recentWeight * r + (1 - recentWeight) * p;

  const minutes = blend(n ? recent.reduce((s, r) => s + r.minutes, 0) / n : 0, prior ? prior.minutes / prior.appearances : 0);
  const stats = Object.fromEntries(statKeys.map((k) => [k, blend(avg(k), priorAvg(k))]));
  return { minutes, stats, sample: n };
}

export function houseLine(mean: number): number {
  return Math.max(0.5, Math.round(mean - 0.5 - 1e-9) + 0.5);
}

export interface HouseLine {
  playerExternalId: string;
  marketCode: string;
  line: number;
}

/**
 * Линии для игроков основы: до maxPerTeam самых результативных игроков каждой
 * команды (по сумме ожиданий относительно порогов рынков).
 */
export function buildHouseLines(
  forms: PlayerForm[],
  rules: HouseMarketRule[],
  { maxPerTeam = 5 }: { maxPerTeam?: number } = {},
): HouseLine[] {
  const keys = rules.map((r) => r.stat);
  const scored = forms.flatMap((form) => {
    const e = expectedPerGame(form, keys);
    if (!e || e.minutes < MIN_EXPECTED_MINUTES) return [];
    const lines = rules
      .filter((r) => e.stats[r.stat] >= r.minMean)
      .map((r) => ({ playerExternalId: form.playerExternalId, marketCode: r.code, line: houseLine(e.stats[r.stat]) }));
    if (lines.length === 0) return [];
    const score = rules.reduce((s, r) => s + e.stats[r.stat] / r.minMean, 0);
    return [{ team: form.teamExternalId, score, lines }];
  });

  const byTeam = new Map<string, typeof scored>();
  for (const s of scored) byTeam.set(s.team, [...(byTeam.get(s.team) ?? []), s]);
  return [...byTeam.values()].flatMap((players) =>
    players
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerTeam)
      .flatMap((p) => p.lines),
  );
}
