// Провайдеры результатов: фактическая статистика спортсменов для матчей,
// линии которых пришли от другого источника (например, OddsPapi).

import type { LeagueCode, SportId } from "../types.ts";
import type { TeamNames } from "./matching.ts";

/** Матч из нашей БД, ожидающий результатов (RPC matches_awaiting_external_results). */
export interface AwaitingMatch {
  match_id: string;
  league_code: LeagueCode;
  sport_id?: SportId;
  starts_at: string;
  home: TeamNames;
  away: TeamNames;
  /** Спортсмены, на которых есть линии в этом матче. */
  players: { player_id: string; full_name: string }[];
  link: { provider: string; external_game_id: string } | null;
}

export interface ExternalTeam {
  names: string[];
  abbr?: string | null;
}

export interface ExternalGame {
  gameId: string;
  startsAt: string;
  home: ExternalTeam;
  away: ExternalTeam;
}

export interface ExternalPlayerLine {
  fullName: string;
  didPlay: boolean;
  /** Ключи совпадают с markets.components. */
  stats: Record<string, number>;
}

export interface ExternalGameResult {
  gameId: string;
  /** Результат официальный и окончательный. */
  final: boolean;
  homeScore: number | null;
  awayScore: number | null;
  players: ExternalPlayerLine[];
}

export interface ResultsProvider {
  /** Значение player_statistics.source и match_result_links.provider. */
  readonly id: string;
  readonly leagues: LeagueCode[];
  /** Провайдер обслуживает вид спорта целиком (любые турниры), например Dota 2. */
  readonly sports?: SportId[];
  /** Игры провайдера в окне вокруг времени начала (для поиска по командам). */
  findGames(match: AwaitingMatch): Promise<ExternalGame[]>;
  getGameResult(gameId: string): Promise<ExternalGameResult | null>;
}
