// Независимый от источника контракт спортивных данных.
// Код не использует API Deno/Node — только fetch, поэтому работает
// в Supabase Edge Functions и тестируется в Vitest.

export type SportId = "hockey" | "football" | "basketball";
export type LeagueCode = "KHL" | "NHL" | "RPL" | "EPL" | "UCL" | "NBA";
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "CANCELLED" | "POSTPONED";

export interface ProviderSport {
  id: SportId;
  externalId: string;
  name: string;
}

export interface ProviderLeague {
  code: LeagueCode;
  sportId: SportId;
  externalId: string;
  name: string;
}

export interface ProviderTeam {
  externalId: string;
  sportId: SportId;
  name: string;
  shortName: string;
  abbr: string;
  color?: string | null;
  logoUrl?: string | null;
}

export interface ProviderPlayer {
  externalId: string;
  sportId: SportId;
  teamExternalId: string | null;
  fullName: string;
  position?: string | null;
  jerseyNumber?: number | null;
  photoUrl?: string | null;
}

export interface ProviderMatch {
  externalId: string;
  leagueCode: LeagueCode;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  startsAt: string;
  status: MatchStatus;
}

/** Линия на статистический показатель. marketCode — код рынка в нашей БД. */
export interface ProviderPlayerProp {
  matchExternalId: string;
  playerExternalId: string;
  marketCode: string;
  line: number;
}

export interface ProviderPlayerStats {
  playerExternalId: string;
  didPlay: boolean;
  /** Ключи совпадают с markets.components: goals, assists, points, ... */
  stats: Record<string, number>;
}

export interface ProviderMatchResult {
  matchExternalId: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  /** true — статистика окончательная и может использоваться для расчёта. */
  confirmed: boolean;
  players: ProviderPlayerStats[];
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ProviderCapabilities {
  /** Провайдер отдаёт линии (матчи и player props). */
  lines: boolean;
  /** Провайдер отдаёт фактическую статистику спортсменов. */
  results: boolean;
}

export interface SportsDataProvider {
  /** Значение поля source в БД. */
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  getSports(): Promise<ProviderSport[]>;
  getLeagues(): Promise<ProviderLeague[]>;
  getMatches(range: DateRange): Promise<{ matches: ProviderMatch[]; teams: ProviderTeam[] }>;
  getPlayers(params: { matchExternalIds: string[] }): Promise<ProviderPlayer[]>;
  getPlayerProps(params: { matchExternalIds: string[] }): Promise<ProviderPlayerProp[]>;
  /**
   * Фактическая статистика матча. null — результатов пока нет.
   * force — только для Demo Provider: досрочно «завершить» матч.
   */
  getPlayerStats(params: { matchExternalId: string; force?: boolean }): Promise<ProviderMatchResult | null>;
}

export class ProviderCapabilityError extends Error {
  constructor(provider: string, capability: string) {
    super(`Провайдер ${provider} не поддерживает: ${capability}`);
    this.name = "ProviderCapabilityError";
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`${provider}: HTTP ${status} для ${url}: ${body.slice(0, 300)}`);
    this.name = "ProviderHttpError";
  }
}

/** Кэш ответов внешних API (реализация — таблица provider_cache). */
export interface ProviderCache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export const noopCache: ProviderCache = {
  get: async () => null,
  set: async () => {},
};
