// Собственные линии PICKUP на матчи НХЛ по статистике BALLDONTLIE (тариф ALL-STAR).
// Один запуск:
//  1) берёт матчи НХЛ из расписания на ближайшие часы и сопоставляет их с матчами
//     BALLDONTLIE по времени и командам;
//  2) для каждой команды загружает статистику игроков во всех матчах сезона (кэш 3 ч);
//  3) по форме (последние матчи) выставляет линии до maxPerTeam игрокам команды.
// Матчи, на которые уже есть линии букмекеров (OddsPapi), пропускаются — одни и те же
// спортсмены не задваиваются. Результаты и расчёт — BallDontLieNhlResultsProvider.

import {
  type BallDontLieNhlResultsProvider,
  type BdlBoxScore,
  type BdlGame,
  toiMinutes,
} from "../sports-providers/results/balldontlie-nhl-results-provider.ts";
import { pickGame } from "../sports-providers/results/sync-results.ts";
import type { AwaitingMatch } from "../sports-providers/results/types.ts";
import { buildHouseLines, HOCKEY_MINUTES, HOCKEY_RULES, type PlayerForm, type StatLine } from "./engine.ts";
import { HOUSE_SOURCE, type HouseLinesPayload, type ScheduleMatch } from "./sync-house.ts";

export interface NhlHouseSink {
  scheduleMatches(leagueCode: string, from: string, to: string): Promise<ScheduleMatch[]>;
  ingestHouseLines(source: string, payload: HouseLinesPayload): Promise<Record<string, number>>;
}

export interface NhlHouseOptions {
  now?: Date;
  /** Окно расписания вперёд, часов. */
  hoursAhead?: number;
  maxPerTeam?: number;
  /** Крайний срок запуска (мс, Date.now()). */
  deadline?: number;
}

const PROVIDER = "balldontlie";
const MAX_RECENT = 10;
/** Игрок должен был выходить хотя бы в одном из последних матчей команды (обмены, травмы). */
const ACTIVE_WITHIN_GAMES = 3;

/** Статистика игрока за матч в формате движка; «очки» = голы + передачи. */
function statLine(b: BdlBoxScore): StatLine {
  const goals = b.goals ?? 0;
  const assists = b.assists ?? 0;
  return {
    minutes: toiMinutes(b.time_on_ice),
    stats: { goals, assists, points: goals + assists, shots_on_goal: b.shots_on_goal ?? 0, saves: b.saves ?? 0 },
  };
}

export async function syncNhlHouseLines(bdl: BallDontLieNhlResultsProvider, sink: NhlHouseSink, options: NhlHouseOptions = {}) {
  const now = options.now ?? new Date();
  const report = { matches: 0, unmatched: 0, skipped_with_lines: 0, projections: 0, suspended: 0, complete: true };
  const timeLeft = () => {
    if (options.deadline !== undefined && Date.now() > options.deadline) report.complete = false;
    return report.complete;
  };

  // Линии — не позже чем за 30 минут до начала.
  const schedule = await sink.scheduleMatches(
    "NHL",
    new Date(now.getTime() + 30 * 60_000).toISOString(),
    new Date(now.getTime() + (options.hoursAhead ?? 72) * 3600_000).toISOString(),
  );
  if (schedule.length === 0) return report;

  // Дата матча у лиги — местная: запрашиваются и предыдущие сутки (UTC).
  const dates = [
    ...new Set(
      schedule.flatMap((m) => [-1, 0].map((d) => new Date(Date.parse(m.starts_at) + d * 86_400_000).toISOString().slice(0, 10))),
    ),
  ];
  const games = await bdl.gamesOn(dates);
  const byId = new Map(games.map((g) => [String(g.id), g]));
  const external = games.map((g) => ({
    gameId: String(g.id),
    startsAt: g.start_time_utc,
    home: { names: [g.home_team.full_name], abbr: g.home_team.tricode },
    away: { names: [g.away_team.full_name], abbr: g.away_team.tricode },
  }));

  type Meta = { team: number; name: string; position: string | null; number: number | null; latestAt: string };
  const prepared: { m: ScheduleMatch; ourTeam: Map<number, string>; forms: PlayerForm[]; meta: Map<string, Meta> }[] = [];
  for (const m of schedule) {
    if (!timeLeft()) break;
    if ((m.other_lines ?? 0) > 0) {
      report.skipped_with_lines++;
      continue;
    }
    const picked = pickGame(
      { match_id: m.id, league_code: "NHL", starts_at: m.starts_at, home: m.home, away: m.away, players: [], link: null } as AwaitingMatch,
      external,
    );
    const game: BdlGame | undefined = picked ? byId.get(picked.game.gameId) : undefined;
    if (!picked || !game) {
      report.unmatched++;
      continue;
    }
    // Команда BALLDONTLIE → команда матча в расписании.
    const ourTeam = new Map<number, string>([
      [game.home_team.id, picked.swapped ? m.away.id : m.home.id],
      [game.away_team.id, picked.swapped ? m.home.id : m.away.id],
    ]);

    // Все матчи сезона обеих команд: игрок, сыгравший за обе (обмен), относится к команде
    // своего последнего матча — линии на него не дублируются.
    const rows: BdlBoxScore[] = [];
    for (const team of [game.home_team, game.away_team]) {
      rows.push(...(await bdl.teamSeasonBoxScores(team.id, game.season)).filter((b) => b.team.id === team.id));
    }
    const byPlayer = new Map<number, BdlBoxScore[]>();
    for (const b of rows
      // Только завершённые матчи до этого (форма), без самого матча.
      .filter((b) => b.game.id !== game.id && b.game.game_state === "OFF" && Date.parse(b.game.start_time_utc) < now.getTime())
      .sort((a, b) => b.game.start_time_utc.localeCompare(a.game.start_time_utc))) {
      byPlayer.set(b.player.id, [...(byPlayer.get(b.player.id) ?? []), b]);
    }
    // Последние матчи каждой команды: игрок без них — ушёл по обмену или травмирован.
    const recentGames = new Map<number, Set<number>>();
    for (const team of [game.home_team, game.away_team]) {
      const ids = [...new Map(
        [...byPlayer.values()].flat().filter((b) => b.team.id === team.id).map((b) => [b.game.id, b.game.start_time_utc] as const),
      )]
        .sort((a, b) => b[1].localeCompare(a[1]))
        .slice(0, ACTIVE_WITHIN_GAMES)
        .map(([gameId]) => gameId);
      recentGames.set(team.id, new Set(ids));
    }
    const forms: PlayerForm[] = [];
    const meta = new Map<string, Meta>();
    for (const [id, list] of byPlayer) {
      const latest = list[0];
      if (!ourTeam.has(latest.team.id) || !recentGames.get(latest.team.id)?.has(latest.game.id)) continue;
      meta.set(String(id), {
        team: latest.team.id,
        name: latest.player.full_name,
        position: latest.position ?? null,
        number: latest.sweater_number ?? null,
        latestAt: latest.game.start_time_utc,
      });
      forms.push({ playerExternalId: String(id), teamExternalId: String(latest.team.id), recent: list.slice(0, MAX_RECENT).map(statLine), prior: null });
    }

    prepared.push({ m, ourTeam, forms, meta });
  }

  // Свежий обмен: игрок встречается в нескольких матчах запуска за разные команды —
  // остаётся команда, за которую он сыграл последним.
  const latestAt = new Map<string, string>();
  for (const { meta } of prepared) {
    for (const [id, p] of meta) if (p.latestAt > (latestAt.get(id) ?? "")) latestAt.set(id, p.latestAt);
  }

  const payload: HouseLinesPayload = { matches: [] };
  for (const { m, ourTeam, forms, meta } of prepared) {
    const current = forms.filter((f) => meta.get(f.playerExternalId)!.latestAt === latestAt.get(f.playerExternalId));
    const lines = buildHouseLines(current, HOCKEY_RULES, { maxPerTeam: options.maxPerTeam ?? 20, minutes: HOCKEY_MINUTES });
    if (lines.length === 0) continue;
    payload.matches.push({
      match_id: m.id,
      players: [...new Set(lines.map((l) => l.playerExternalId))].map((id) => {
        const p = meta.get(id)!;
        return {
          external_id: `${PROVIDER}:player:${id}`,
          team_id: ourTeam.get(p.team)!,
          full_name: p.name,
          position: p.position,
          jersey_number: p.number,
        };
      }),
      projections: [...new Map(lines.map((l) => [`${l.playerExternalId}:${l.marketCode}`, l])).values()].map((l) => ({
        player_external_id: `${PROVIDER}:player:${l.playerExternalId}`,
        market_code: l.marketCode,
        line: l.line,
      })),
    });
    report.matches++;
  }

  if (payload.matches.length > 0) {
    const result = await sink.ingestHouseLines(HOUSE_SOURCE, payload);
    report.projections = result.projections ?? 0;
    report.suspended = result.suspended ?? 0;
  }
  return report;
}
