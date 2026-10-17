// Конвейер синхронизации: провайдер → пакет данных → RPC ingest_* в PostgreSQL.
// Получение линий и получение результатов разделены.

import type { OddsPapiProvider } from "./oddspapi/oddspapi-provider.ts";
import type { ProviderMatchResult, SportId, SportsDataProvider } from "./types.ts";

export interface SlatePayload {
  teams: Record<string, unknown>[];
  players: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  projections: Record<string, unknown>[];
}

export interface ResultsPayload {
  matches: Record<string, unknown>[];
}

/** Куда записываются данные (в Edge Function — Supabase RPC). */
export interface SyncSink {
  ingestSlate(source: string, payload: SlatePayload): Promise<Record<string, number>>;
  ingestResults(source: string, payload: ResultsPayload): Promise<Record<string, number>>;
  matchesAwaitingResults(source: string, limit: number): Promise<string[]>;
  setTeamNamesEn?(source: string, items: { external_id: string; name_en: string; abbr_en: string | null }[]): Promise<number>;
}

export async function syncLines(
  provider: SportsDataProvider,
  sink: SyncSink,
  { now = new Date(), daysAhead = 3 }: { now?: Date; daysAhead?: number } = {},
) {
  const to = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const { matches, teams } = await provider.getMatches({ from: now, to });
  const upcoming = matches.filter((m) => m.status === "SCHEDULED").map((m) => m.externalId);
  // Для OddsPapi игроки известны только из коэффициентов: сначала линии.
  const props = await provider.getPlayerProps({ matchExternalIds: upcoming });
  const players = await provider.getPlayers({ matchExternalIds: upcoming });

  const payload: SlatePayload = {
    teams: teams.map((t) => ({
      external_id: t.externalId,
      sport_id: t.sportId,
      name: t.name,
      short_name: t.shortName,
      abbr: t.abbr,
      color: t.color ?? null,
      logo_url: t.logoUrl ?? null,
    })),
    players: players.map((p) => ({
      external_id: p.externalId,
      sport_id: p.sportId,
      team_external_id: p.teamExternalId,
      full_name: p.fullName,
      position: p.position ?? null,
      jersey_number: p.jerseyNumber ?? null,
      photo_url: p.photoUrl ?? null,
    })),
    matches: matches.map((m) => ({
      external_id: m.externalId,
      league_code: m.leagueCode,
      home_team_external_id: m.homeTeamExternalId,
      away_team_external_id: m.awayTeamExternalId,
      starts_at: m.startsAt,
      status: m.status,
    })),
    projections: props.map((p) => ({
      match_external_id: p.matchExternalId,
      player_external_id: p.playerExternalId,
      market_code: p.marketCode,
      line: p.line,
    })),
  };
  return sink.ingestSlate(provider.id, payload);
}

export function toResultsPayload(results: ProviderMatchResult[]): ResultsPayload {
  return {
    matches: results.map((r) => ({
      external_id: r.matchExternalId,
      status: r.status,
      home_score: r.homeScore,
      away_score: r.awayScore,
      confirmed: r.confirmed,
      players: r.players.map((p) => ({
        external_id: p.playerExternalId,
        did_play: p.didPlay,
        stats: p.stats,
      })),
    })),
  };
}

export async function syncResults(
  provider: SportsDataProvider,
  sink: SyncSink,
  { limit = 50 }: { limit?: number } = {},
) {
  if (!provider.capabilities.results) {
    return { skipped: 1 };
  }
  const awaiting = await sink.matchesAwaitingResults(provider.id, limit);
  const results: ProviderMatchResult[] = [];
  for (const externalId of awaiting) {
    const result = await provider.getPlayerStats({ matchExternalId: externalId });
    if (result) results.push(result);
  }
  if (results.length === 0) return { matches: 0, lineups_settled: 0 };
  return sink.ingestResults(provider.id, toResultsPayload(results));
}

// ---------------------------------------------------------------------------
// Полное расписание реальных событий (OddsPapi) и линии для уже загруженных матчей.
// ---------------------------------------------------------------------------


export interface ScheduleSink {
  ingestSchedule(source: string, payload: Record<string, unknown[]>): Promise<Record<string, number>>;
}

/** По одному запросу на вид спорта: окно от hoursBack назад (обновить статусы) до hoursAhead вперёд. */
export async function syncSchedule(
  provider: OddsPapiProvider,
  sink: ScheduleSink,
  sports: { id: SportId; opSportId: string }[],
  { now = new Date(), hoursBack = 6, hoursAhead = 72 }: { now?: Date; hoursBack?: number; hoursAhead?: number } = {},
) {
  const report: Record<string, unknown> = {};
  const range = { from: new Date(now.getTime() - hoursBack * 3600_000), to: new Date(now.getTime() + hoursAhead * 3600_000) };
  for (const sport of sports) {
    try {
      const data = await provider.getSchedule(sport.opSportId, sport.id, range);
      report[sport.id] = await sink.ingestSchedule(provider.id, {
        leagues: data.leagues,
        teams: data.teams.map((t) => ({
          external_id: t.externalId,
          sport_id: t.sportId,
          name: t.name,
          short_name: t.shortName,
          abbr: t.abbr,
        })),
        matches: data.matches.map((m) => ({
          external_id: m.externalId,
          tournament_id: m.tournamentId,
          home_team_external_id: m.homeTeamExternalId,
          away_team_external_id: m.awayTeamExternalId,
          starts_at: m.startsAt,
          status: m.status,
        })),
      });
    } catch (e) {
      report[sport.id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return report;
}

export interface PropsCandidate {
  externalId: string;
  leagueCode: string;
  sportId: SportId;
  startsAt: string;
}

/** Линии на игроков для матчей, уже загруженных расписанием (без запроса матчей). */
export async function syncPropsForMatches(provider: OddsPapiProvider, sink: SyncSink, candidates: PropsCandidate[]) {
  if (candidates.length === 0) return { projections: 0, players: 0 };
  provider.primeFixtures(candidates);
  const props = await provider.getPlayerProps({ matchExternalIds: candidates.map((c) => c.externalId) });
  const players = await provider.getPlayers();
  const namesEn = provider.getTeamNamesEn();
  const renamed = namesEn.length && sink.setTeamNamesEn ? await sink.setTeamNamesEn(provider.id, namesEn) : 0;
  const result = await sink.ingestSlate(provider.id, {
    teams: [],
    players: players.map((p) => ({
      external_id: p.externalId,
      sport_id: p.sportId,
      team_external_id: p.teamExternalId,
      full_name: p.fullName,
      position: p.position ?? null,
      jersey_number: p.jerseyNumber ?? null,
      photo_url: p.photoUrl ?? null,
    })),
    matches: [],
    projections: props.map((p) => ({
      match_external_id: p.matchExternalId,
      player_external_id: p.playerExternalId,
      market_code: p.marketCode,
      line: p.line,
    })),
  });
  return { ...result, team_names_en: renamed };
}
