// Статистика НБА из BALLDONTLIE (api.balldontlie.io/v1), тариф ALL-STAR.
// Лицензированный источник: коммерческое и фэнтези-использование разрешено
// (https://www.balldontlie.io/terms, разд. 6). Проверено на реальных ответах:
//   GET /games?dates[]=…                 — матчи: команды (full_name, abbreviation), datetime, status ("Final")
//   GET /stats?game_ids[]=…              — весь состав матча: min ("40", у не игравших "00"), pts, reb, ast, fg3m
//   GET /players/active?team_ids[]=…     — текущий состав команды (для «не играл» и линий)
//   GET /season_averages?season&player_id — средние за сезон (форма новичков команды)

import { noopCache, ProviderHttpError, type LeagueCode, type ProviderCache } from "../types.ts";
import type { AwaitingMatch, ExternalGame, ExternalGameResult, ExternalPlayerLine, ResultsProvider } from "./types.ts";

export interface NbaTeam {
  id: number;
  full_name: string;
  abbreviation: string;
}

export interface NbaGame {
  id: number;
  date: string;
  datetime: string | null;
  season: number;
  status: string;
  home_team: NbaTeam;
  visitor_team: NbaTeam;
  home_team_score: number | null;
  visitor_team_score: number | null;
}

export interface NbaPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position?: string | null;
  jersey_number?: string | null;
  team?: NbaTeam;
}

export interface NbaStatRow {
  player: NbaPlayer;
  team: NbaTeam;
  game: { id: number; date: string; datetime?: string | null; status: string; season: number };
  min: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
}

export interface NbaSeasonAverage {
  player_id: number;
  games_played: number;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
}

interface Page<T> {
  data: T[];
  meta?: { next_cursor?: number | null };
}

export const nbaName = (p: NbaPlayer) => `${p.first_name} ${p.last_name}`.trim();

/** «40» или «33:13» → минуты на площадке. */
export function nbaMinutes(min: string | null | undefined): number {
  const m = /^(\d+)(?::(\d{2}))?$/.exec(min ?? "");
  return m ? Number(m[1]) + Number(m[2] ?? 0) / 60 : 0;
}

/** Статистика игрока в формате рынков: points, rebounds, assists, threes_made. */
export function nbaStats(r: { pts: number | null; reb: number | null; ast: number | null; fg3m: number | null }) {
  return { points: r.pts ?? 0, rebounds: r.reb ?? 0, assists: r.ast ?? 0, threes_made: r.fg3m ?? 0 };
}

export class BallDontLieNbaResultsProvider implements ResultsProvider {
  readonly id = "balldontlie-nba";
  readonly leagues: LeagueCode[] = ["NBA"];
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: ProviderCache;
  private readonly minIntervalMs: number;
  private lastCall = 0;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      fetch?: typeof fetch;
      cache?: ProviderCache;
      /** Пауза между запросами: тариф ALL-STAR — 60 запросов в минуту. */
      minIntervalMs?: number;
    },
  ) {
    if (!options.apiKey) throw new Error("BALLDONTLIE_API_KEY не задан");
    this.baseUrl = (options.baseUrl ?? "https://api.balldontlie.io/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.cache = options.cache ?? noopCache;
    this.minIntervalMs = options.minIntervalMs ?? 1050;
  }

  gamesOn(dates: string[]): Promise<NbaGame[]> {
    return this.all<NbaGame>("games", dates.map((d) => ["dates[]", d]));
  }

  async findGames(match: AwaitingMatch): Promise<ExternalGame[]> {
    // Дата матча у лиги — местная (США), поэтому запрашиваются и предыдущие сутки (UTC).
    const start = new Date(match.starts_at).getTime();
    const days = [...new Set([-1, 0].map((d) => new Date(start + d * 86_400_000).toISOString().slice(0, 10)))];
    const team = (t: NbaTeam) => ({ names: [t.full_name], abbr: t.abbreviation });
    return (await this.gamesOn(days))
      .filter((g) => g.datetime)
      .map((g) => ({ gameId: String(g.id), startsAt: g.datetime!, home: team(g.home_team), away: team(g.visitor_team) }));
  }

  async getGameResult(gameId: string): Promise<ExternalGameResult | null> {
    // Фильтр games?ids[] сервер игнорирует — матч запрашивается по адресу /games/{id}.
    const game = (await this.one<{ data: NbaGame }>(`games/${encodeURIComponent(gameId)}`)).data;
    if (!game) return null;
    const rows = await this.all<NbaStatRow>("stats", [["game_ids[]", gameId]]);
    const final = game.status === "Final";
    const players: ExternalPlayerLine[] = rows.map((r) => ({
      fullName: nbaName(r.player),
      didPlay: nbaMinutes(r.min) > 0,
      stats: nbaStats(r),
    }));
    if (final) {
      // Игрок текущего состава, которого нет в протоколе завершённого матча, не играл.
      const inGame = new Set(rows.map((r) => r.player.id));
      for (const team of [game.home_team, game.visitor_team]) {
        for (const p of await this.activeRoster(team.id).catch(() => [])) {
          if (inGame.has(p.id)) continue;
          inGame.add(p.id);
          players.push({ fullName: nbaName(p), didPlay: false, stats: nbaStats({ pts: 0, reb: 0, ast: 0, fg3m: 0 }) });
        }
      }
    }
    return { gameId: String(game.id), final, homeScore: game.home_team_score, awayScore: game.visitor_team_score, players };
  }

  /** Текущий состав команды; кэш на 6 часов. */
  async activeRoster(teamId: number): Promise<NbaPlayer[]> {
    const key = `balldontlie:nba:active:${teamId}`;
    const cached = await this.cache.get<NbaPlayer[]>(key);
    if (cached) return cached;
    const rows = await this.all<NbaPlayer>("players/active", [["team_ids[]", String(teamId)]]);
    await this.cache.set(key, rows, 6 * 3600);
    return rows;
  }

  /** Статистика игроков команды в её последних завершённых матчах (текущий и прошлый сезон); кэш 3 часа. */
  async teamRecentStats(teamId: number, season: number, games = 10): Promise<NbaStatRow[]> {
    const key = `balldontlie:nba:recent:${season}:${teamId}:${games}`;
    const cached = await this.cache.get<NbaStatRow[]>(key);
    if (cached) return cached;
    const list = await this.all<NbaGame>("games", [["team_ids[]", String(teamId)], ["seasons[]", String(season)], ["seasons[]", String(season - 1)]]);
    const ids = list
      .filter((g) => g.status === "Final")
      .sort((a, b) => (b.datetime ?? b.date).localeCompare(a.datetime ?? a.date))
      .slice(0, games)
      .map((g) => String(g.id));
    const rows = ids.length ? (await this.all<NbaStatRow>("stats", ids.map((id) => ["game_ids[]", id]))).filter((r) => r.team.id === teamId) : [];
    await this.cache.set(key, rows, 3 * 3600);
    return rows;
  }

  /** Средние игрока за сезон; кэш на 7 дней. */
  async seasonAverage(playerId: number, season: number): Promise<NbaSeasonAverage | null> {
    const key = `balldontlie:nba:avg:${season}:${playerId}`;
    const cached = await this.cache.get<{ v: NbaSeasonAverage | null }>(key);
    if (cached) return cached.v;
    const rows = await this.all<NbaSeasonAverage>("season_averages", [["season", String(season)], ["player_id", String(playerId)]]);
    const v = rows[0] ?? null;
    await this.cache.set(key, { v }, 7 * 86_400);
    return v;
  }

  private async one<T>(endpoint: string): Promise<T> {
    const wait = this.lastCall + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/${endpoint}`, { headers: { Authorization: this.options.apiKey, Accept: "application/json" } });
    if (!res.ok) throw new ProviderHttpError(this.id, res.status, `${this.baseUrl}/${endpoint}`, await res.text());
    return (await res.json()) as T;
  }

  /** Все страницы выдачи (курсорная пагинация, по 100 записей). */
  private async all<T>(endpoint: string, params: [string, string][]): Promise<T[]> {
    const out: T[] = [];
    let cursor: number | null | undefined = undefined;
    for (let page = 0; page < 30; page++) {
      const query = new URLSearchParams([...params, ["per_page", "100"], ...(cursor ? [["cursor", String(cursor)] as [string, string]] : [])]);
      const url = `${this.baseUrl}/${endpoint}?${query}`;
      const wait = this.lastCall + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      const res = await this.fetchImpl(url, { headers: { Authorization: this.options.apiKey, Accept: "application/json" } });
      if (!res.ok) throw new ProviderHttpError(this.id, res.status, `${this.baseUrl}/${endpoint}`, await res.text());
      const body = (await res.json()) as Page<T>;
      out.push(...body.data);
      cursor = body.meta?.next_cursor;
      if (!cursor || body.data.length < 100) break;
    }
    return out;
  }
}
