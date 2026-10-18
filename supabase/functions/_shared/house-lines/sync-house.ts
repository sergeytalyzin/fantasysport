// Собственные линии PICKUP для лиг без линий букмекеров на игроков (футбол).
// Один запуск:
//  1) копит историю — статистику всех игроков завершённых матчей лиги за вчера и сегодня;
//  2) для команд ближайших матчей загружает итоги текущего сезона (раз в неделю) и
//     прошлого сезона (один раз) — основа формы игрока;
//  3) выставляет линии игрокам основы на матчи сегодня и завтра.
// Матчи берутся из расписания (OddsPapi): матч API-Football сопоставляется с ним по
// времени и командам, линии прикрепляются к нему — дубли не создаются. Матч без
// однозначного соответствия пропускается. Результаты и live — из API-Football.

import {
  type AfFixture,
  type ApiFootballResultsProvider,
  FINAL,
} from "../sports-providers/results/apifootball-results-provider.ts";
import { pickGame } from "../sports-providers/results/sync-results.ts";
import type { AwaitingMatch } from "../sports-providers/results/types.ts";
import { buildHouseLines, FOOTBALL_RULES, type PlayerForm, type StatLine } from "./engine.ts";

export const HOUSE_SOURCE = "pickup";
const PROVIDER = "apifootball";

export interface HistoryRow {
  provider: string;
  league_code: string;
  player_external_id: string;
  player_name: string;
  team_external_id: string;
  fixture_external_id: string;
  played_at: string;
  minutes: number;
  stats: Record<string, number>;
}

export interface PriorRow {
  provider: string;
  league_code: string;
  season: number;
  player_external_id: string;
  player_name: string;
  appearances: number;
  minutes: number;
  totals: Record<string, number>;
}

export interface HouseSink {
  knownFixtures(provider: string, fixtureIds: string[]): Promise<Set<string>>;
  saveHistory(rows: HistoryRow[]): Promise<void>;
  savePriors(rows: PriorRow[]): Promise<void>;
  loadForms(
    provider: string,
    season: number,
    playerIds: string[],
  ): Promise<{ history: Map<string, StatLine[]>; priors: Map<string, PlayerForm["prior"]> }>;
  getProgress(key: string): Promise<{ nextPage: number; totalPages: number | null } | null>;
  setProgress(key: string, value: { nextPage: number; totalPages: number | null }): Promise<void>;
  /** Матчи лиги из расписания в окне времени (названия команд — английские, если известны). */
  scheduleMatches(leagueCode: string, from: string, to: string): Promise<ScheduleMatch[]>;
  ingestHouseLines(source: string, payload: HouseLinesPayload): Promise<Record<string, number>>;
}

export interface ScheduleMatch {
  id: string;
  starts_at: string;
  /** Открытые линии из других источников (букмекеры) — такие матчи линии PICKUP не дублируют. */
  other_lines?: number;
  home: { id: string; name: string; short_name?: string | null; abbr?: string | null };
  away: { id: string; name: string; short_name?: string | null; abbr?: string | null };
}

export interface HouseLinesPayload {
  matches: {
    match_id: string;
    players: { external_id: string; team_id: string; full_name: string; position: string | null; jersey_number: number | null }[];
    projections: { player_external_id: string; market_code: string; line: number }[];
  }[];
}

export interface HouseOptions {
  leagueCode: string;
  leagueId: string;
  now?: Date;
  /**
   * Крайний срок запуска (мс, Date.now()). Edge Function живёт ограниченное время,
   * поэтому первичная загрузка идёт частями: запуск останавливается и продолжится в следующий раз.
   */
  deadline?: number;
  /** Прошлый сезон для формы игрока; по умолчанию — предыдущий к сезону ближайших матчей. */
  priorSeason?: number;
  maxPerTeam?: number;
}

const POSITIONS: Record<string, string> = {
  Goalkeeper: "Вратарь",
  Defender: "Защитник",
  Midfielder: "Полузащитник",
  Attacker: "Нападающий",
};

/** Страниц выдачи игроков на команду (по 20 игроков) — хватает на весь состав. */
const MAX_PAGES = 3;

const day = (d: Date) => d.toISOString().slice(0, 10);

type Prior = NonNullable<PlayerForm["prior"]>;

/** Основа формы: текущий сезон, если в нём не меньше 3 матчей, иначе прошлый — от 8 матчей. */
export function pickPrior(current: Prior | null | undefined, previous: Prior | null | undefined): Prior | null {
  if (current && current.appearances >= 3) return current;
  if (previous && previous.appearances >= 8) return previous;
  return null;
}

/** Матч расписания, однозначно соответствующий матчу API-Football (время ±, команды). */
function findScheduleMatch(f: AfFixture, schedule: ScheduleMatch[]): { match: ScheduleMatch; swapped: boolean } | null {
  const game = {
    gameId: String(f.fixture.id),
    startsAt: f.fixture.date,
    home: { names: [f.teams.home.name] },
    away: { names: [f.teams.away.name] },
  };
  const found = schedule.flatMap((m) => {
    const picked = pickGame({ match_id: m.id, league_code: "", starts_at: m.starts_at, home: m.home, away: m.away, players: [], link: null } as AwaitingMatch, [game]);
    return picked ? [{ match: m, swapped: picked.swapped }] : [];
  });
  return found.length === 1 ? found[0] : null;
}

export async function syncHouseLines(af: ApiFootballResultsProvider, sink: HouseSink, options: HouseOptions) {
  const now = options.now ?? new Date();
  const ofLeague = (f: AfFixture) => String(f.league?.id) === options.leagueId;
  const report = {
    history_fixtures: 0,
    history_rows: 0,
    prior_pages: 0,
    matches: 0,
    /** Матчи API-Football без однозначного соответствия в расписании (пропущены). */
    unmatched: 0,
    projections: 0,
    /** Устаревшие линии матчей, приостановленные при пересчёте. */
    suspended: 0,
    prior_errors: [] as string[],
    /** false — запуск остановлен по времени, работа продолжится в следующий раз. */
    complete: true,
  };
  const timeLeft = () => {
    if (options.deadline !== undefined && Date.now() > options.deadline) report.complete = false;
    return report.complete;
  };

  // 1. История формы.
  for (const date of [day(new Date(now.getTime() - 86_400_000)), day(now)]) {
    const finished = (await af.fixturesOn(date)).filter((f) => ofLeague(f) && FINAL.has(f.fixture.status?.short ?? ""));
    const known = await sink.knownFixtures(PROVIDER, finished.map((f) => String(f.fixture.id)));
    for (const f of finished.filter((x) => !known.has(String(x.fixture.id)))) {
      if (!timeLeft()) break;
      const rows = (await af.fixturePlayers(String(f.fixture.id)))
        .filter((p) => p.minutes > 0)
        .map((p) => ({
          provider: PROVIDER,
          league_code: options.leagueCode,
          player_external_id: String(p.playerId),
          player_name: p.name,
          team_external_id: String(p.teamId ?? ""),
          fixture_external_id: String(f.fixture.id),
          played_at: f.fixture.date,
          minutes: p.minutes,
          stats: p.stats,
        }));
      await sink.saveHistory(rows);
      report.history_fixtures++;
      report.history_rows += rows.length;
    }
  }

  // 3. Линии на матчи сегодня и завтра (не позже чем за 30 минут до начала).
  const upcoming = (
    await Promise.all([day(now), day(new Date(now.getTime() + 86_400_000))].map((d) => af.fixturesOn(d)))
  )
    .flat()
    .filter((f) => ofLeague(f) && f.fixture.status?.short === "NS" && Date.parse(f.fixture.date) > now.getTime() + 30 * 60_000);
  if (upcoming.length === 0) return report;
  const currentSeason = Math.max(...upcoming.map((f) => f.league?.season ?? 0));
  const priorSeason = options.priorSeason ?? currentSeason - 1;
  // Итоги текущего сезона меняются каждый тур — перезагружаются раз в неделю.
  const week = Math.floor(now.getTime() / (7 * 86_400_000));

  // Линии — только на матчи, которые есть в расписании сайта.
  const times = upcoming.map((f) => Date.parse(f.fixture.date));
  const schedule = await sink.scheduleMatches(
    options.leagueCode,
    new Date(Math.min(...times) - 6 * 3600_000).toISOString(),
    new Date(Math.max(...times) + 6 * 3600_000).toISOString(),
  );
  const targets = upcoming.flatMap((f) => {
    const target = f.teams.home.id != null && f.teams.away.id != null ? findScheduleMatch(f, schedule) : null;
    if (!target) report.unmatched++;
    return target ? [{ f, ...target }] : [];
  });
  if (targets.length === 0) return report;

  // 2. Итоги текущего и прошлого сезона для команд ближайших матчей.
  const seasons = [
    { season: currentSeason, key: (team: number) => `house:priors:${options.leagueCode}:${currentSeason}:team:${team}:w${week}` },
    { season: priorSeason, key: (team: number) => `house:priors:${options.leagueCode}:${priorSeason}:team:${team}` },
  ];
  for (const team of new Set(targets.flatMap(({ f }) => [f.teams.home.id!, f.teams.away.id!]))) {
    for (const { season, key: keyOf } of seasons) {
      const key = keyOf(team);
      if (await sink.getProgress(key)) continue;
      if (!timeLeft()) break;
      try {
        let totalPages = 1;
        for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
          const result = await af.seasonPlayersPage(team, options.leagueId, season, page);
          totalPages = result.totalPages;
          await sink.savePriors(
            result.players
              .filter((p) => p.appearances > 0)
              .map((p) => ({
                provider: PROVIDER,
                league_code: options.leagueCode,
                season,
                player_external_id: String(p.playerId),
                player_name: p.name,
                appearances: p.appearances,
                minutes: p.minutes,
                totals: p.totals,
              })),
          );
          report.prior_pages++;
        }
        await sink.setProgress(key, { nextPage: totalPages + 1, totalPages });
      } catch (e) {
        // Нет данных за сезон (например, команда тогда играла в другой лиге) —
        // форма считается по другому сезону и свежим матчам.
        report.prior_errors.push(`team ${team}, season ${season}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const payload: HouseLinesPayload = { matches: [] };
  for (const { f, match, swapped } of targets) {
    if (!timeLeft()) break;
    const sides = [f.teams.home, f.teams.away];
    // Команда API-Football → команда матча в расписании.
    const ourTeam = new Map<number, string>([
      [f.teams.home.id!, swapped ? match.away.id : match.home.id],
      [f.teams.away.id!, swapped ? match.home.id : match.away.id],
    ]);
    const roster = new Map<string, { team: number; name: string; position: string | null; number: number | null }>();
    for (const team of sides) {
      for (const p of await af.squad(team.id!)) {
        if (p.position !== "Goalkeeper") roster.set(String(p.id), { team: team.id!, name: p.name, position: p.position, number: p.number });
      }
    }
    const ids = [...roster.keys()];
    const { history, priors: current } = await sink.loadForms(PROVIDER, currentSeason, ids);
    const { priors: previous } = await sink.loadForms(PROVIDER, priorSeason, ids);
    const forms: PlayerForm[] = [...roster.entries()].map(([id, p]) => ({
      playerExternalId: id,
      teamExternalId: String(p.team),
      recent: history.get(id) ?? [],
      // Текущий сезон — от 3 матчей, иначе прошлый сезон — от 8 матчей (новички, вернувшиеся после травм).
      prior: pickPrior(current.get(id), previous.get(id)),
    }));
    const lines = buildHouseLines(forms, FOOTBALL_RULES, { maxPerTeam: options.maxPerTeam ?? 15 });
    if (lines.length === 0) continue;

    payload.matches.push({
      match_id: match.id,
      players: [...new Set(lines.map((l) => l.playerExternalId))].map((id) => {
        const p = roster.get(id)!;
        return {
          external_id: `${PROVIDER}:player:${id}`,
          team_id: ourTeam.get(p.team)!,
          full_name: p.name,
          position: p.position ? (POSITIONS[p.position] ?? p.position) : null,
          jersey_number: p.number,
        };
      }),
      projections: lines.map((l) => ({
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
