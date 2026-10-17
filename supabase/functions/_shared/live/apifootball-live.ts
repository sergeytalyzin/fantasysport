// Live футбола из API-Football: GET /fixtures?id — статус, минута, счёт и события
// (проверено на реальном ответе). Координат событий API не даёт — на схеме поля
// события показываются по своей половине, а главное — лента событий.

import type { LiveEvent, LiveEventKind, LiveSnapshot, LiveState } from "./types.ts";

export interface AfFixtureLive {
  fixture: { status: { short: string; elapsed: number | null; extra?: number | null } };
  teams: { home: { id: number }; away: { id: number } };
  goals: { home: number | null; away: number | null };
  events?: {
    time: { elapsed: number; extra: number | null };
    team: { id: number };
    player: { name: string | null };
    assist: { name: string | null };
    type: string;
    detail: string;
  }[];
}

const NOT_STARTED = new Set(["TBD", "NS"]);
const BREAK = new Set(["HT", "BT", "INT"]);
const FINISHED = new Set(["FT", "AET", "PEN", "AWD", "WO", "CANC", "ABD", "PST"]);

function stateOf(short: string): LiveState {
  if (NOT_STARTED.has(short)) return "PRE";
  if (FINISHED.has(short)) return "FINAL";
  if (BREAK.has(short)) return "BREAK";
  return "LIVE";
}

function kindOf(type: string, detail: string): LiveEventKind | null {
  if (type === "Goal") return detail === "Missed Penalty" ? "miss" : "goal";
  if (type === "Card") return detail.includes("Red") ? "red-card" : "card";
  if (type === "subst") return "sub";
  return null;
}

const DETAILS: Record<string, string> = {
  "Own Goal": "автогол",
  Penalty: "пенальти",
  "Missed Penalty": "незабитый пенальти",
  "Yellow Card": "жёлтая карточка",
  "Red Card": "красная карточка",
  "Second Yellow card": "вторая жёлтая",
};

export function apiFootballSnapshot(f: AfFixtureLive, now = new Date()): LiveSnapshot {
  const homeId = f.teams.home.id;
  const s = stateOf(f.fixture.status.short);
  const events: LiveEvent[] = [];
  (f.events ?? []).forEach((e, i) => {
    const kind = kindOf(e.type, e.detail);
    if (!kind) return;
    const minute = e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : "");
    events.push({
      id: `${i}`,
      kind,
      side: e.team.id === homeId ? "home" : "away",
      label: `${minute}'`,
      order: e.time.elapsed * 100 + (e.time.extra ?? 0),
      // В замене player — уходящий игрок, assist — выходящий на поле.
      player: (kind === "sub" ? (e.assist.name ?? e.player.name) : e.player.name)?.trim() ?? null,
      detail:
        kind === "sub"
          ? e.player.name
            ? `вместо: ${e.player.name.trim()}`
            : null
          : (DETAILS[e.detail] ?? (kind === "goal" && e.assist.name ? `пас: ${e.assist.name.trim()}` : null)),
      x: null,
      y: null,
    });
  });
  events.sort((a, b) => a.order - b.order);

  const elapsed = f.fixture.status.elapsed;
  return {
    provider: "apifootball",
    sport: "football",
    state: s,
    status:
      s === "FINAL" ? "Матч завершён" : s === "PRE" ? "Скоро начало" : s === "BREAK" ? "Перерыв" : elapsed ? `${elapsed}'` : "Идёт",
    clock: null,
    home: { score: f.goals.home ?? 0, shots: null },
    away: { score: f.goals.away ?? 0, shots: null },
    events,
    leaders: [],
    surface: "pitch",
    updatedAt: now.toISOString(),
  };
}
