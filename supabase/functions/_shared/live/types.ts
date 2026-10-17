// Снимок live-состояния матча для экрана трансляции. Не участвует в расчёте
// прогнозов — только отображение.

import type { SportId } from "../sports-providers/types.ts";

export type LiveState = "PRE" | "LIVE" | "BREAK" | "FINAL";

export type LiveEventKind = "goal" | "shot" | "miss" | "penalty" | "card" | "red-card" | "sub";

export interface LiveEvent {
  id: string;
  kind: LiveEventKind;
  side: "home" | "away";
  /** «1-й период · 05:12», «67'». */
  label: string;
  /** Порядок по ходу матча. */
  order: number;
  player: string | null;
  detail: string | null;
  /**
   * Координаты, нормализованные так, что хозяева атакуют вправо.
   * Хоккей: x ∈ [-100, 100], y ∈ [-42.5, 42.5] (футы, как в NHL API).
   * Футбол: x ∈ [0, 105], y ∈ [0, 68] (метры).
   */
  x?: number | null;
  y?: number | null;
}

export interface LiveLeader {
  name: string;
  side: "home" | "away";
  value: number;
  stat: string;
}

export interface LiveSnapshot {
  provider: "nhl" | "apifootball";
  sport: SportId;
  state: LiveState;
  /** «2-й период», «Перерыв», «67'», «Матч завершён». */
  status: string;
  clock: string | null;
  home: { score: number; shots: number | null };
  away: { score: number; shots: number | null };
  /** Хронологически. */
  events: LiveEvent[];
  leaders: LiveLeader[];
  /** Есть ли координаты событий для схемы. */
  surface: "rink" | "pitch" | "court";
  updatedAt: string;
}
