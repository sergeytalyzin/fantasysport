// Live НХЛ из play-by-play (api-web.nhle.com/v1/gamecenter/{id}/play-by-play).
// Структура проверена на реальных ответах: gameState, clock, periodDescriptor,
// homeTeam/awayTeam {score, sog}, plays[] с details.xCoord/yCoord, rosterSpots.

import type { LiveEvent, LiveEventKind, LiveSnapshot, LiveState } from "./types.ts";

interface NhlPlay {
  eventId: number;
  typeDescKey: string;
  sortOrder?: number;
  timeInPeriod?: string;
  homeTeamDefendingSide?: string;
  periodDescriptor: { number: number; periodType: string };
  details?: {
    xCoord?: number;
    yCoord?: number;
    eventOwnerTeamId?: number;
    scoringPlayerId?: number;
    shootingPlayerId?: number;
    assist1PlayerId?: number;
    committedByPlayerId?: number;
    descKey?: string;
    duration?: number;
    shotType?: string;
  };
}

export interface NhlPlayByPlay {
  gameState: string;
  clock?: { timeRemaining?: string; inIntermission?: boolean; running?: boolean };
  periodDescriptor?: { number: number; periodType: string };
  homeTeam: { id: number; score?: number; sog?: number };
  awayTeam: { id: number; score?: number; sog?: number };
  plays?: NhlPlay[];
  rosterSpots?: { playerId: number; firstName: { default: string }; lastName: { default: string } }[];
}

const KINDS: Record<string, LiveEventKind> = {
  goal: "goal",
  "shot-on-goal": "shot",
  "missed-shot": "miss",
  penalty: "penalty",
};

export function periodName(number: number, type: string): string {
  if (type === "OT") return "Овертайм";
  if (type === "SO") return "Буллиты";
  return `${number}-й период`;
}

function state(pbp: NhlPlayByPlay): LiveState {
  if (["OFF", "FINAL"].includes(pbp.gameState)) return "FINAL";
  if (["LIVE", "CRIT"].includes(pbp.gameState)) return pbp.clock?.inIntermission ? "BREAK" : "LIVE";
  return "PRE";
}

const PENALTIES: Record<string, string> = {
  tripping: "подножка",
  hooking: "задержка клюшкой",
  slashing: "удар клюшкой",
  "high-sticking": "высоко поднятая клюшка",
  interference: "блокировка",
  roughing: "грубость",
  holding: "задержка",
  "cross-checking": "толчок клюшкой",
  "delaying-game-puck-over-glass": "затяжка времени",
  fighting: "драка",
};

export function nhlSnapshot(pbp: NhlPlayByPlay, now = new Date()): LiveSnapshot {
  const names = new Map((pbp.rosterSpots ?? []).map((r) => [r.playerId, `${r.firstName.default} ${r.lastName.default}`]));
  const homeId = pbp.homeTeam.id;
  const events: LiveEvent[] = [];

  for (const play of pbp.plays ?? []) {
    const kind = KINDS[play.typeDescKey];
    const d = play.details;
    if (!kind || !d?.eventOwnerTeamId) continue;
    // Хозяева всегда атакуют вправо: если они защищают правые ворота, отражаем точку.
    const flip = play.homeTeamDefendingSide === "right" ? -1 : 1;
    const playerId = d.scoringPlayerId ?? d.shootingPlayerId ?? d.committedByPlayerId;
    const assist = d.assist1PlayerId ? names.get(d.assist1PlayerId) : undefined;
    events.push({
      id: String(play.eventId),
      kind,
      side: d.eventOwnerTeamId === homeId ? "home" : "away",
      label: `${periodName(play.periodDescriptor.number, play.periodDescriptor.periodType)} · ${play.timeInPeriod ?? ""}`,
      order: play.sortOrder ?? play.eventId,
      player: playerId ? (names.get(playerId) ?? null) : null,
      detail:
        kind === "penalty"
          ? `${d.duration ?? 2} мин · ${PENALTIES[d.descKey ?? ""] ?? d.descKey ?? "нарушение"}`
          : kind === "goal" && assist
            ? `пас: ${assist}`
            : null,
      x: typeof d.xCoord === "number" ? d.xCoord * flip : null,
      y: typeof d.yCoord === "number" ? d.yCoord * flip : null,
    });
  }
  events.sort((a, b) => a.order - b.order);

  const s = state(pbp);
  const period = pbp.periodDescriptor;
  return {
    provider: "nhl",
    sport: "hockey",
    state: s,
    status:
      s === "FINAL"
        ? "Матч завершён"
        : s === "PRE"
          ? "Скоро начало"
          : s === "BREAK"
            ? "Перерыв"
            : period
              ? periodName(period.number, period.periodType)
              : "Идёт",
    clock: s === "LIVE" ? (pbp.clock?.timeRemaining ?? null) : null,
    home: { score: pbp.homeTeam.score ?? 0, shots: pbp.homeTeam.sog ?? null },
    away: { score: pbp.awayTeam.score ?? 0, shots: pbp.awayTeam.sog ?? null },
    events,
    leaders: [],
    surface: "rink",
    updatedAt: now.toISOString(),
  };
}
