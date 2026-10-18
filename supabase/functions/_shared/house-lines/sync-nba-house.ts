// Собственные линии PICKUP на матчи НБА по статистике BALLDONTLIE (тариф ALL-STAR).
// Один запуск:
//  1) берёт матчи НБА из расписания и сопоставляет их с матчами BALLDONTLIE по времени и командам;
//  2) для каждой команды — текущий состав и статистика её последних матчей (кэш);
//  3) форма игрока — его последние матчи; если их меньше трёх (новичок, начало сезона) —
//     средние за прошлый сезон; линии до maxPerTeam игрокам текущего состава.
// Матчи с линиями букмекеров (OddsPapi) пропускаются. Расчёт — BallDontLieNbaResultsProvider.

import {
  type BallDontLieNbaResultsProvider,
  type NbaGame,
  type NbaStatRow,
  nbaMinutes,
  nbaName,
  nbaStats,
} from "../sports-providers/results/balldontlie-nba-results-provider.ts";
import { pickGame } from "../sports-providers/results/sync-results.ts";
import type { AwaitingMatch } from "../sports-providers/results/types.ts";
import { BASKETBALL_MINUTES, BASKETBALL_RULES, buildHouseLines, type PlayerForm, type StatLine } from "./engine.ts";
import type { NhlHouseSink as HouseScheduleSink } from "./sync-nhl-house.ts";
import { HOUSE_SOURCE, type HouseLinesPayload } from "./sync-house.ts";

const PROVIDER = "balldontlie-nba";
const MIN_RECENT_PLAYED = 3;

/** Показатели игрока с комбинированными рынками. */
function withCombos(s: { points: number; rebounds: number; assists: number; threes_made: number }) {
  return {
    ...s,
    pts_reb_ast: s.points + s.rebounds + s.assists,
    pts_reb: s.points + s.rebounds,
    pts_ast: s.points + s.assists,
  };
}

const statLine = (r: NbaStatRow): StatLine => ({ minutes: nbaMinutes(r.min), stats: withCombos(nbaStats(r)) });

export async function syncNbaHouseLines(
  bdl: BallDontLieNbaResultsProvider,
  sink: HouseScheduleSink,
  options: { now?: Date; hoursAhead?: number; maxPerTeam?: number; deadline?: number } = {},
) {
  const now = options.now ?? new Date();
  const report = { matches: 0, unmatched: 0, skipped_with_lines: 0, projections: 0, suspended: 0, complete: true };
  const timeLeft = () => {
    if (options.deadline !== undefined && Date.now() > options.deadline) report.complete = false;
    return report.complete;
  };

  const schedule = await sink.scheduleMatches(
    "NBA",
    new Date(now.getTime() + 30 * 60_000).toISOString(),
    new Date(now.getTime() + (options.hoursAhead ?? 72) * 3600_000).toISOString(),
  );
  if (schedule.length === 0) return report;

  const dates = [
    ...new Set(
      schedule.flatMap((m) => [-1, 0].map((d) => new Date(Date.parse(m.starts_at) + d * 86_400_000).toISOString().slice(0, 10))),
    ),
  ];
  const games = (await bdl.gamesOn(dates)).filter((g) => g.datetime);
  const byId = new Map(games.map((g) => [String(g.id), g]));
  const external = games.map((g) => ({
    gameId: String(g.id),
    startsAt: g.datetime!,
    home: { names: [g.home_team.full_name], abbr: g.home_team.abbreviation },
    away: { names: [g.visitor_team.full_name], abbr: g.visitor_team.abbreviation },
  }));

  const payload: HouseLinesPayload = { matches: [] };
  for (const m of schedule) {
    if (!timeLeft()) break;
    if ((m.other_lines ?? 0) > 0) {
      report.skipped_with_lines++;
      continue;
    }
    const picked = pickGame(
      { match_id: m.id, league_code: "NBA", starts_at: m.starts_at, home: m.home, away: m.away, players: [], link: null } as AwaitingMatch,
      external,
    );
    const game: NbaGame | undefined = picked ? byId.get(picked.game.gameId) : undefined;
    if (!picked || !game) {
      report.unmatched++;
      continue;
    }
    const ourTeam = new Map<number, string>([
      [game.home_team.id, picked.swapped ? m.away.id : m.home.id],
      [game.visitor_team.id, picked.swapped ? m.home.id : m.away.id],
    ]);

    const forms: PlayerForm[] = [];
    const meta = new Map<string, { team: number; name: string; position: string | null; number: number | null }>();
    for (const team of [game.home_team, game.visitor_team]) {
      // Только текущий состав: игроки, ушедшие из команды, линий не получают.
      const roster = await bdl.activeRoster(team.id);
      const recent = await bdl.teamRecentStats(team.id, game.season);
      for (const p of roster) {
        const rows = recent
          .filter((r) => r.player.id === p.id)
          .sort((a, b) => (b.game.datetime ?? b.game.date).localeCompare(a.game.datetime ?? a.game.date));
        let prior: PlayerForm["prior"] = null;
        if (rows.filter((r) => nbaMinutes(r.min) > 0).length < MIN_RECENT_PLAYED && timeLeft()) {
          const avg = await bdl.seasonAverage(p.id, game.season - 1);
          if (avg && avg.games_played > 0) {
            const per = withCombos(nbaStats(avg));
            prior = {
              appearances: avg.games_played,
              minutes: nbaMinutes(avg.min) * avg.games_played,
              totals: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v * avg.games_played])),
            };
          }
        }
        const number = Number(p.jersey_number);
        meta.set(String(p.id), { team: team.id, name: nbaName(p), position: p.position ?? null, number: Number.isFinite(number) ? number : null });
        forms.push({ playerExternalId: String(p.id), teamExternalId: String(team.id), recent: rows.map(statLine), prior });
      }
    }

    const lines = buildHouseLines(forms, BASKETBALL_RULES, { maxPerTeam: options.maxPerTeam ?? 15, minutes: BASKETBALL_MINUTES });
    if (lines.length === 0) continue;
    payload.matches.push({
      match_id: m.id,
      players: [...new Set(lines.map((l) => l.playerExternalId))].map((id) => {
        const p = meta.get(id)!;
        return { external_id: `${PROVIDER}:player:${id}`, team_id: ourTeam.get(p.team)!, full_name: p.name, position: p.position, jersey_number: p.number };
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
