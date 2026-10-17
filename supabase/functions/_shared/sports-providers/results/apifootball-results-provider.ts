// Статистика футболистов из API-Football (api-sports.io), бесплатный тариф —
// 100 запросов в сутки. Используемые эндпоинты:
//   GET /fixtures?date                 — все матчи за день (фильтр по нашим лигам)
//   GET /fixtures?id                   — статус и счёт матча
//   GET /fixtures/players?fixture      — статистика игроков в матче
// Заголовок авторизации: x-apisports-key.
//
// Структура ответа проверена на живых данных (scripts/apifootball-probe.mjs).
// Бесплатный тариф: параметр season текущего сезона недоступен, но матчи
// за дату отдаются в окне «вчера–завтра» — этого достаточно для результатов.
// Поэтому матчи ищутся по дате (один запрос в сутки на все лиги, с кэшем).
// Разбор защитный: null трактуется как 0 только у сыгравших игроков.

import { noopCache, type LeagueCode, type ProviderCache, ProviderHttpError } from "../types.ts";
import type { AwaitingMatch, ExternalGame, ExternalGameResult, ExternalPlayerLine, ResultsProvider } from "./types.ts";

interface AfEnvelope<T> {
  response?: T[];
  errors?: unknown;
}

interface AfFixture {
  fixture: { id: number; date: string; status?: { short?: string } };
  league?: { id: number };
  teams: { home: { name: string }; away: { name: string } };
  goals?: { home: number | null; away: number | null };
}

interface AfPlayerStats {
  games?: { minutes?: number | null };
  shots?: { total?: number | null; on?: number | null };
  goals?: { total?: number | null };
  passes?: { total?: number | null };
}

interface AfTeamPlayers {
  team: { name: string };
  players: { player: { id: number; name: string }; statistics: AfPlayerStats[] | AfPlayerStats }[];
}

export interface ApiFootballLeague {
  code: LeagueCode;
  leagueId: string;
}

// Окончание матча: основное время, после овертайма, после пенальти.
const FINAL = new Set(["FT", "AET", "PEN"]);

export class ApiFootballResultsProvider implements ResultsProvider {
  readonly id = "apifootball";
  readonly leagues: LeagueCode[];
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: ProviderCache;
  private readonly minIntervalMs: number;
  private lastCall = 0;

  constructor(
    private readonly options: {
      apiKey: string;
      leagues: ApiFootballLeague[];
      baseUrl?: string;
      fetch?: typeof fetch;
      cache?: ProviderCache;
      /** Пауза между запросами; бесплатный тариф ограничивает частоту. */
      minIntervalMs?: number;
    },
  ) {
    if (!options.apiKey) throw new Error("APIFOOTBALL_API_KEY не задан");
    this.leagues = options.leagues.map((l) => l.code);
    this.baseUrl = (options.baseUrl ?? "https://v3.football.api-sports.io").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.cache = options.cache ?? noopCache;
    this.minIntervalMs = options.minIntervalMs ?? 6500;
  }

  async findGames(match: AwaitingMatch): Promise<ExternalGame[]> {
    const league = this.options.leagues.find((l) => l.code === match.league_code);
    if (!league) return [];
    const date = new Date(match.starts_at).toISOString().slice(0, 10);
    const cacheKey = `apifootball:fixtures:${date}`;

    let fixtures = await this.cache.get<AfFixture[]>(cacheKey);
    if (!fixtures) {
      const ours = new Set(this.options.leagues.map((l) => l.leagueId));
      fixtures = (await this.get<AfFixture>("fixtures", { date })).filter((f) => ours.has(String(f.league?.id)));
      await this.cache.set(cacheKey, fixtures, 1800);
    }
    return fixtures
      .filter((f) => String(f.league?.id) === league.leagueId)
      .map((f) => ({
        gameId: String(f.fixture.id),
        startsAt: f.fixture.date,
        home: { names: [f.teams.home.name] },
        away: { names: [f.teams.away.name] },
      }));
  }

  async getGameResult(gameId: string): Promise<ExternalGameResult | null> {
    const [fixture] = await this.get<AfFixture>("fixtures", { id: gameId });
    if (!fixture) return null;
    const final = FINAL.has(fixture.fixture.status?.short ?? "");
    if (!final) {
      return { gameId, final: false, homeScore: fixture.goals?.home ?? null, awayScore: fixture.goals?.away ?? null, players: [] };
    }

    const teams = await this.get<AfTeamPlayers>("fixtures/players", { fixture: gameId });
    const players: ExternalPlayerLine[] = [];
    for (const team of teams) {
      for (const entry of team.players ?? []) {
        const s = Array.isArray(entry.statistics) ? entry.statistics[0] : entry.statistics;
        const minutes = s?.games?.minutes ?? 0;
        const didPlay = minutes > 0;
        players.push({
          fullName: entry.player.name,
          didPlay,
          stats: didPlay
            ? {
                goals: s?.goals?.total ?? 0,
                shots: s?.shots?.total ?? 0,
                shots_on_target: s?.shots?.on ?? 0,
                passes: s?.passes?.total ?? 0,
              }
            : {},
        });
      }
    }
    return {
      gameId,
      final: true,
      homeScore: fixture.goals?.home ?? null,
      awayScore: fixture.goals?.away ?? null,
      players,
    };
  }

  private async get<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
    const wait = this.lastCall + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();

    const url = `${this.baseUrl}/${endpoint}?${new URLSearchParams(params)}`;
    const res = await this.fetchImpl(url, { headers: { "x-apisports-key": this.options.apiKey } });
    if (!res.ok) throw new ProviderHttpError(this.id, res.status, url, await res.text());
    const body = (await res.json()) as AfEnvelope<T>;
    // API-Football сообщает об ошибках ключа и лимитов в поле errors при HTTP 200.
    const errors = body.errors;
    const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && typeof errors === "object" && Object.keys(errors).length > 0;
    if (hasErrors) throw new Error(`apifootball: ${JSON.stringify(errors)}`);
    return body.response ?? [];
  }
}
