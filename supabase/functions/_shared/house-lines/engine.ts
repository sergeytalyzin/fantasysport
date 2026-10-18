// Генератор собственных линий PICKUP по статистике игроков.
//
// Ожидаемое значение показателя за матч = смесь свежей формы (последние матчи,
// где игрок провёл на поле/на льду не меньше порога вида спорта) и итогов сезона. Вес формы
// растёт с числом сыгранных матчей: n / (n + PRIOR_WEIGHT). Линия — ближайшее
// к ожиданию значение x.5 (при равенстве — меньшее), так что «Больше» и «Меньше»
// примерно равновероятны, а ровно попасть в линию нельзя.
// Линии выставляются игрокам основы и ротации (пороги минут — FOOTBALL_MINUTES, HOCKEY_MINUTES);
// если игрок в матче не выйдет, выбор на него аннулируется.

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

/** Пороги игрового времени: в форму — матчи от minRecentMinutes, линии — при среднем от minExpectedMinutes. */
export interface MinutesRules {
  minRecentMinutes: number;
  minExpectedMinutes: number;
}

/** Футбол: минуты на поле; основа и ротация. */
export const FOOTBALL_MINUTES: MinutesRules = { minRecentMinutes: 15, minExpectedMinutes: 30 };

/** Хоккей: время на льду (нападающие 10–20 мин, защитники 15–25, вратарь ~60). */
export const HOCKEY_MINUTES: MinutesRules = { minRecentMinutes: 5, minExpectedMinutes: 8 };

/** Хоккей: рынки по статистике BALLDONTLIE NHL (box scores). «Очки» = голы + передачи. */
export const HOCKEY_RULES: HouseMarketRule[] = [
  { code: "shots_on_goal", stat: "shots_on_goal", minMean: 1.2 },
  { code: "points", stat: "points", minMean: 0.35 },
  { code: "goals", stat: "goals", minMean: 0.25 },
  { code: "assists", stat: "assists", minMean: 0.3 },
  { code: "saves", stat: "saves", minMean: 15 },
];

/** Баскетбол: минуты на площадке (основа 25–38, ротация 10–20). */
export const BASKETBALL_MINUTES: MinutesRules = { minRecentMinutes: 5, minExpectedMinutes: 12 };

/** Баскетбол: рынки по статистике BALLDONTLIE NBA; комбинированные — суммы показателей. */
export const BASKETBALL_RULES: HouseMarketRule[] = [
  { code: "points", stat: "points", minMean: 6 },
  { code: "rebounds", stat: "rebounds", minMean: 3 },
  { code: "assists", stat: "assists", minMean: 2 },
  { code: "threes", stat: "threes_made", minMean: 0.8 },
  { code: "pts_reb_ast", stat: "pts_reb_ast", minMean: 12 },
  { code: "pts_reb", stat: "pts_reb", minMean: 9 },
  { code: "pts_ast", stat: "pts_ast", minMean: 8 },
];

/** Футбол: рынки, которые бесплатно отдаёт API-Football (проверено на реальных матчах). */
export const FOOTBALL_RULES: HouseMarketRule[] = [
  { code: "shots", stat: "shots", minMean: 0.9 },
  { code: "shots_on_target", stat: "shots_on_target", minMean: 0.6 },
  { code: "passes", stat: "passes", minMean: 20 },
  { code: "goals", stat: "goals", minMean: 0.3 },
];

const PRIOR_WEIGHT = 3;
const MAX_RECENT = 8;
const MIN_RECENT_GAMES = 2;
// Порог выборки задаёт вызывающий код: текущий сезон — от 3 матчей, прошлый — от 8 (sync-house.ts).
const MIN_PRIOR_GAMES = 3;

export interface Expectation {
  minutes: number;
  stats: Record<string, number>;
  /** Число свежих матчей в оценке. */
  sample: number;
}

/** Ожидаемые значения за матч или null, если данных недостаточно. */
export function expectedPerGame(
  form: PlayerForm,
  statKeys: string[],
  minRecentMinutes = FOOTBALL_MINUTES.minRecentMinutes,
): Expectation | null {
  const recent = form.recent.filter((r) => r.minutes >= minRecentMinutes).slice(0, MAX_RECENT);
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
 * Линии для игроков основы и ротации: до maxPerTeam самых результативных игроков каждой
 * команды (по сумме ожиданий относительно порогов рынков).
 */
export function buildHouseLines(
  forms: PlayerForm[],
  rules: HouseMarketRule[],
  { maxPerTeam = 15, minutes = FOOTBALL_MINUTES }: { maxPerTeam?: number; minutes?: MinutesRules } = {},
): HouseLine[] {
  const keys = rules.map((r) => r.stat);
  const scored = forms.flatMap((form) => {
    const e = expectedPerGame(form, keys, minutes.minRecentMinutes);
    if (!e || e.minutes < minutes.minExpectedMinutes) return [];
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
