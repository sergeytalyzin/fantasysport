// Статистика НХЛ из BALLDONTLIE (api.balldontlie.io/nhl/v1), тариф ALL-STAR.
// Лицензированный источник: условия разрешают коммерческое и фэнтези-использование
// (https://www.balldontlie.io/terms, разд. 6). Проверено на реальных ответах:
//   GET /games?dates[]=…        — матчи: команды (full_name, tricode), start_time_utc, game_state ("OFF" — окончательно)
//   GET /box_scores?game_ids[]= — игроки, вышедшие в состав: goals, assists, shots_on_goal, saves, time_on_ice
//   GET /players?team_ids[]&seasons[] — состав команды на сезон (для «не играл»)
//   GET /box_scores?team_ids[]&seasons[] — все матчи команды в сезоне (форма игроков для линий PICKUP)
// Play-by-play (/plays) на ALL-STAR недоступен — live остаётся на NHL API.

import { noopCache, ProviderHttpError, type LeagueCode, type ProviderCache } from "../types.ts";
import type { AwaitingMatch, ExternalGame, ExternalGameResult, ExternalPlayerLine, ResultsProvider } from "./types.ts";

export interface BdlTeam {
  id: number;
  full_name: string;
  tricode: string;
}

export interface BdlGame {
  id: number;
  season: number;
  start_time_utc: string;
  home_team: BdlTeam;
  away_team: BdlTeam;
  home_score: number | null;
  away_score: number | null;
  game_state: string;
}

interface BdlPlayer {
  id: number;
  full_name: string;
}

export interface BdlBoxScore {
  player: BdlPlayer;
  team: BdlTeam;
  game: BdlGame;
  position: string;
  goals?: number | null;
  assists?: number | null;
  shots_on_goal?: number | null;
  saves?: number | null;
  time_on_ice?: string | null;
  sweater_number?: number | null;
}

interface Page<T> {
  data: T[];
  meta?: { next_cursor?: number | null };
}

const FINAL_STATES = new Set(["OFF"]);
const played = (toi: string | null | undefined) => Boolean(toi) && !/^0?0:00$/.test(toi!);

/** «13:57» → 13,95 минуты на льду. */
export function toiMinutes(toi: string | null | undefined): number {
  const m = /^(\d+):(\d{2})$/.exec(toi ?? "");
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}

export class BallDontLieNhlResultsProvider implements ResultsProvider {
  readonly id = "balldontlie";
  readonly leagues: LeagueCode[] = ["NHL"];
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
    this.baseUrl = (options.baseUrl ?? "https://api.balldontlie.io/nhl/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.cache = options.cache ?? noopCache;
    this.minIntervalMs = options.minIntervalMs ?? 1050;
  }

  /** Матчи за даты (UTC-сутки лиги). */
  gamesOn(dates: string[]): Promise<BdlGame[]> {
    return this.all<BdlGame>("games", dates.map((d) => ["dates[]", d]));
  }

  /** Статистика всех игроков команды во всех матчах сезона; кэш на 3 часа. */
  async teamSeasonBoxScores(teamId: number, season: number): Promise<BdlBoxScore[]> {
    const key = `balldontlie:nhl:box:${season}:team:${teamId}`;
    const cached = await this.cache.get<BdlBoxScore[]>(key);
    if (cached) return cached;
    const rows = await this.all<BdlBoxScore>("box_scores", [["team_ids[]", String(teamId)], ["seasons[]", String(season)]]);
    await this.cache.set(key, rows, 3 * 3600);
    return rows;
  }

  async findGames(match: AwaitingMatch): Promise<ExternalGame[]> {
    // Дата матча у лиги — местная, поэтому запрашиваются и предыдущие сутки (UTC).
    const start = new Date(match.starts_at).getTime();
    const days = [...new Set([-1, 0].map((d) => new Date(start + d * 86_400_000).toISOString().slice(0, 10)))];
    const games = await this.gamesOn(days);
    const team = (t: BdlTeam) => ({ names: [t.full_name], abbr: t.tricode });
    return games.map((g) => ({ gameId: String(g.id), startsAt: g.start_time_utc, home: team(g.home_team), away: team(g.away_team) }));
  }

  async getGameResult(gameId: string): Promise<ExternalGameResult | null> {
    const rows = await this.all<BdlBoxScore>("box_scores", [["game_ids[]", gameId]]);
    if (rows.length === 0) return null;
    const game = rows[0].game;
    const final = FINAL_STATES.has(game.game_state);

    const players: ExternalPlayerLine[] = rows.map((b) => ({
      fullName: b.player.full_name,
      didPlay: played(b.time_on_ice),
      stats: { goals: b.goals ?? 0, assists: b.assists ?? 0, shots_on_goal: b.shots_on_goal ?? 0, saves: b.saves ?? 0 },
    }));

    if (final) {
      // Игрок состава, которого нет в протоколе завершённой игры, не играл (запас, травма).
      const inGame = new Set(rows.map((b) => b.player.id));
      for (const team of [game.home_team, game.away_team]) {
        const roster = await this.all<BdlPlayer>("players", [["team_ids[]", String(team.id)], ["seasons[]", String(game.season)]]).catch(
          () => [],
        );
        for (const p of roster) {
          if (inGame.has(p.id)) continue;
          inGame.add(p.id);
          players.push({ fullName: p.full_name, didPlay: false, stats: { goals: 0, assists: 0, shots_on_goal: 0, saves: 0 } });
        }
      }
    }

    return { gameId: String(game.id), final, homeScore: game.home_score, awayScore: game.away_score, players };
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
