// Собственные линии PICKUP для лиги без линий букмекеров на игроков (РПЛ).
// Один запуск:
//  1) копит историю — статистику всех игроков завершённых матчей лиги за вчера и сегодня;
//  2) один раз на команду загружает итоги прошлого сезона для команд ближайших матчей;
//  3) выставляет линии игрокам основы на матчи сегодня и завтра.
// Источник матчей в БД — "pickup"; результаты и live берутся из API-Football как
// для любой реальной лиги.

import {
  type AfFixture,
  type ApiFootballResultsProvider,
  FINAL,
} from "../sports-providers/results/apifootball-results-provider.ts";
import type { SlatePayload } from "../sports-providers/sync.ts";
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
  ingestSlate(source: string, payload: SlatePayload): Promise<Record<string, number>>;
}

export interface HouseOptions {
  leagueCode: string;
  leagueId: string;
  now?: Date;
  /**
   * Крайний срок запуска (мс, Date.now()). Бесплатный API-Football требует пауз
   * между запросами, а Edge Function живёт ограниченное время, поэтому первичная
   * загрузка идёт частями: запуск останавливается и продолжится в следующий раз.
   */
  deadline?: number;
  priorSeason?: number;
  maxPerTeam?: number;
}

const POSITIONS: Record<string, string> = {
  Goalkeeper: "Вратарь",
  Defender: "Защитник",
  Midfielder: "Полузащитник",
  Attacker: "Нападающий",
};

/** Бесплатный тариф API-Football: не больше 3 страниц выдачи. */
const MAX_PAGES = 3;

const day = (d: Date) => d.toISOString().slice(0, 10);
const abbr = (name: string) => name.replace(/^(FC|FK|PFC)\s+/i, "").replace(/[^\p{L}]/gu, "").slice(0, 3).toUpperCase();

export async function syncHouseLines(af: ApiFootballResultsProvider, sink: HouseSink, options: HouseOptions) {
  const now = options.now ?? new Date();
  const season = options.priorSeason ?? 2024;
  const ofLeague = (f: AfFixture) => String(f.league?.id) === options.leagueId;
  const report = {
    history_fixtures: 0,
    history_rows: 0,
    prior_pages: 0,
    matches: 0,
    projections: 0,
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

  // 2. Итоги прошлого сезона для команд ближайших матчей — один раз на команду.
  for (const team of new Set(upcoming.flatMap((f) => [f.teams.home.id, f.teams.away.id]).filter((id): id is number => id != null))) {
    const key = `house:priors:${options.leagueCode}:${season}:team:${team}`;
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
      // Нет данных прошлого сезона (например, команда тогда играла в другой лиге) —
      // линии появятся по свежей форме.
      report.prior_errors.push(`team ${team}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const payload: SlatePayload = { teams: [], players: [], matches: [], projections: [] };
  for (const f of upcoming) {
    if (!timeLeft()) break;
    const sides = [f.teams.home, f.teams.away];
    if (sides.some((t) => t.id == null)) continue;
    const roster = new Map<string, { team: number; name: string; position: string | null; number: number | null }>();
    for (const team of sides) {
      for (const p of await af.squad(team.id!)) {
        if (p.position !== "Goalkeeper") roster.set(String(p.id), { team: team.id!, name: p.name, position: p.position, number: p.number });
      }
    }
    const { history, priors } = await sink.loadForms(PROVIDER, season, [...roster.keys()]);
    const forms: PlayerForm[] = [...roster.entries()].map(([id, p]) => ({
      playerExternalId: id,
      teamExternalId: String(p.team),
      recent: history.get(id) ?? [],
      prior: priors.get(id) ?? null,
    }));
    const lines = buildHouseLines(forms, FOOTBALL_RULES, { maxPerTeam: options.maxPerTeam ?? 5 });
    if (lines.length === 0) continue;

    const matchId = `${PROVIDER}:fixture:${f.fixture.id}`;
    for (const team of sides) {
      payload.teams.push({
        external_id: `${PROVIDER}:team:${team.id}`,
        sport_id: "football",
        name: team.name,
        short_name: team.name,
        abbr: abbr(team.name),
        color: null,
        logo_url: null,
      });
    }
    payload.matches.push({
      external_id: matchId,
      league_code: options.leagueCode,
      home_team_external_id: `${PROVIDER}:team:${f.teams.home.id}`,
      away_team_external_id: `${PROVIDER}:team:${f.teams.away.id}`,
      starts_at: new Date(f.fixture.date).toISOString(),
      status: "SCHEDULED",
    });
    for (const id of new Set(lines.map((l) => l.playerExternalId))) {
      const p = roster.get(id)!;
      payload.players.push({
        external_id: `${PROVIDER}:player:${id}`,
        sport_id: "football",
        team_external_id: `${PROVIDER}:team:${p.team}`,
        full_name: p.name,
        position: p.position ? (POSITIONS[p.position] ?? p.position) : null,
        jersey_number: p.number,
        photo_url: null,
      });
    }
    for (const l of lines) {
      payload.projections.push({
        match_external_id: matchId,
        player_external_id: `${PROVIDER}:player:${l.playerExternalId}`,
        market_code: l.marketCode,
        line: l.line,
      });
    }
    report.matches++;
  }

  if (payload.matches.length > 0) {
    const result = await sink.ingestSlate(HOUSE_SOURCE, payload);
    report.projections = result.projections ?? 0;
  }
  return report;
}
