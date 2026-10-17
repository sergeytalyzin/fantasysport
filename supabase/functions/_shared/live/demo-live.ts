// Live-симуляция ДЕМО-матча: события разворачиваются в реальном времени между
// началом и концом матча. Таймлайн строится детерминированно из той же итоговой
// статистики, по которой рассчитываются демо-прогнозы, поэтому финальный счёт
// и цифры игроков на экране совпадают с результатом расчёта.

import type { DemoProvider } from "../sports-providers/demo/demo-provider.ts";
import { createRng } from "../sports-providers/random.ts";
import type { SportId } from "../sports-providers/types.ts";
import { periodName } from "./nhl-live.ts";
import type { LiveEvent, LiveEventKind, LiveSnapshot, LiveState } from "./types.ts";

const GAME_MINUTES: Record<SportId, number> = { hockey: 60, football: 90, basketball: 48 };

interface TimedEvent extends Omit<LiveEvent, "id" | "label" | "order"> {
  t: number;
}

const range = (rng: () => number, min: number, max: number) => min + rng() * (max - min);

function place(sport: SportId, kind: LiveEventKind, side: "home" | "away", rng: () => number) {
  if (sport === "hockey") {
    const [x, y] =
      kind === "goal" ? [range(rng, 68, 86), range(rng, -12, 12)] : [range(rng, 40, 86), range(rng, -32, 32)];
    return side === "home" ? { x, y } : { x: -x, y: -y };
  }
  if (sport === "football") {
    const [x, y] =
      kind === "goal" ? [range(rng, 92, 103), range(rng, 26, 42)] : [range(rng, 72, 101), range(rng, 14, 54)];
    return side === "home" ? { x, y } : { x: 105 - x, y: 68 - y };
  }
  return { x: null, y: null };
}

function label(sport: SportId, t: number): string {
  if (sport === "hockey") {
    const period = Math.min(3, Math.floor(t / 20) + 1);
    const inPeriod = t - (period - 1) * 20;
    return `${periodName(period, "REG")} · ${String(Math.floor(inPeriod)).padStart(2, "0")}:${String(Math.floor((inPeriod % 1) * 60)).padStart(2, "0")}`;
  }
  return `${Math.max(1, Math.ceil(t))}'`;
}

export async function demoSnapshot(provider: DemoProvider, matchExternalId: string, now = new Date()): Promise<LiveSnapshot | null> {
  const info = provider.describeMatch(matchExternalId);
  const result = await provider.getPlayerStats({ matchExternalId, force: true });
  if (!info || !result) return null;

  const sport = info.sportId;
  const length = GAME_MINUTES[sport];
  const progress = (now.getTime() - Date.parse(info.startsAt)) / (info.durationMinutes * 60_000);
  const state: LiveState = progress < 0 ? "PRE" : progress >= 1 ? "FINAL" : "LIVE";
  const minute = state === "FINAL" ? length : Math.max(0, progress) * length;

  const rng = createRng(`${matchExternalId}:live`);
  const sideOf = new Map<string, "home" | "away">();
  const names = new Map<string, string>();
  for (const side of ["home", "away"] as const) {
    for (const p of info[side].players) {
      sideOf.set(p.externalId, side);
      names.set(p.externalId, p.name);
    }
  }

  // Полный таймлайн матча из итоговой статистики.
  const timeline: TimedEvent[] = [];
  const add = (kind: LiveEventKind, side: "home" | "away", player: string | null, detail: string | null = null) =>
    timeline.push({ t: range(rng, 0.5, length - 0.5), kind, side, player, detail, ...place(sport, kind, side, rng) });

  const playerGoals = { home: 0, away: 0 };
  if (sport !== "basketball") {
    // Передачи распределяются между партнёрами, у которых они есть в статистике.
    const assists = new Map(result.players.map((p) => [p.playerExternalId, p.stats.assists ?? 0]));
    for (const p of result.players) {
      const side = sideOf.get(p.playerExternalId);
      if (!side || !p.didPlay) continue;
      const name = names.get(p.playerExternalId) ?? null;
      const goals = p.stats.goals ?? 0;
      playerGoals[side] += goals;
      for (let i = 0; i < goals; i++) {
        const assistant = [...assists].find(([id, n]) => n > 0 && id !== p.playerExternalId && sideOf.get(id) === side);
        if (assistant) assists.set(assistant[0], assistant[1] - 1);
        add("goal", side, name, assistant ? `пас: ${names.get(assistant[0])}` : null);
      }
      if (sport === "hockey") {
        for (let i = goals; i < (p.stats.shots_on_goal ?? 0); i++) add("shot", side, name);
      } else {
        for (let i = goals; i < (p.stats.shots_on_target ?? 0); i++) add("shot", side, name);
        for (let i = p.stats.shots_on_target ?? 0; i < (p.stats.shots ?? 0); i++) add("miss", side, name);
      }
    }
    // Голы игроков без отдельной статистики в демо-составе.
    for (const side of ["home", "away"] as const) {
      const total = (side === "home" ? result.homeScore : result.awayScore) ?? 0;
      for (let i = playerGoals[side]; i < total; i++) add("goal", side, null);
    }
  }

  timeline.sort((a, b) => a.t - b.t);
  const revealed = timeline.filter((e) => e.t <= minute);
  const events: LiveEvent[] = revealed.map(({ t, ...e }, i) => ({ ...e, id: String(i), label: label(sport, t), order: i }));

  const count = (side: "home" | "away", kinds: LiveEventKind[]) =>
    revealed.filter((e) => e.side === side && kinds.includes(e.kind)).length;
  const share = state === "FINAL" ? 1 : Math.max(0, progress);

  let home: LiveSnapshot["home"];
  let away: LiveSnapshot["away"];
  let leaders: LiveSnapshot["leaders"] = [];
  if (sport === "basketball") {
    home = { score: Math.round((result.homeScore ?? 0) * share), shots: null };
    away = { score: Math.round((result.awayScore ?? 0) * share), shots: null };
    leaders = result.players
      .filter((p) => p.didPlay && sideOf.has(p.playerExternalId))
      .map((p) => ({
        name: names.get(p.playerExternalId) ?? "",
        side: sideOf.get(p.playerExternalId)!,
        value: Math.floor((p.stats.points ?? 0) * share),
        stat: "очк.",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  } else {
    const shotKinds: LiveEventKind[] = sport === "hockey" ? ["goal", "shot"] : ["goal", "shot", "miss"];
    home = { score: count("home", ["goal"]), shots: count("home", shotKinds) };
    away = { score: count("away", ["goal"]), shots: count("away", shotKinds) };
  }

  const segment = sport === "hockey" ? 20 : sport === "basketball" ? 12 : 45;
  const part = Math.min(Math.floor(minute / segment) + 1, length / segment);
  const remaining = segment - (minute - (part - 1) * segment);
  const clock = `${String(Math.floor(remaining)).padStart(2, "0")}:${String(Math.floor((remaining % 1) * 60)).padStart(2, "0")}`;

  return {
    provider: "demo",
    sport,
    state,
    status:
      state === "FINAL"
        ? "Матч завершён"
        : state === "PRE"
          ? "Скоро начало"
          : sport === "hockey"
            ? periodName(part, "REG")
            : sport === "basketball"
              ? `${part}-я четверть`
              : `${Math.max(1, Math.ceil(minute))}'`,
    clock: state === "LIVE" && sport !== "football" ? clock : null,
    home,
    away,
    events,
    leaders,
    surface: sport === "hockey" ? "rink" : sport === "football" ? "pitch" : "court",
    updatedAt: now.toISOString(),
  };
}
