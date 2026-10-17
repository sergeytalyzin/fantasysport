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
  paging?: { current: number; total: number };
}

export interface AfFixture {
  fixture: { id: number; date: string; status?: { short?: string } };
  league?: { id: number };
  teams: { home: { id?: number; name: string }; away: { id?: number; name: string } };
  goals?: { home: number | null; away: number | null };
}

interface AfPlayerStats {
  games?: { minutes?: number | null; appearences?: number | null };
  shots?: { total?: number | null; on?: number | null };
  goals?: { total?: number | null };
  passes?: { total?: number | null };
}

interface AfTeamPlayers {
  team: { id?: number; name: string };
  players: { player: { id: number; name: string }; statistics: AfPlayerStats[] | AfPlayerStats }[];
}

export interface ApiFootballLeague {
  code: LeagueCode;
  leagueId: string;
}

// Окончание матча: основное время, после овертайма, после пенальти.
export const FINAL = new Set(["FT", "AET", "PEN"]);

export interface FixturePlayerLine {
  teamId: number | null;
  playerId: number;
  name: string;
  minutes: number;
  stats: Record<string, number>;
}

export interface SeasonPlayerTotals {
  playerId: number;
  name: string;
  appearances: number;
  minutes: number;
  totals: Record<string, number>;
}

/** null у сыгравших игроков — это 0 (так API отдаёт нули). */
function statsOf(s: AfPlayerStats | undefined): Record<string, number> {
  return {
    goals: s?.goals?.total ?? 0,
    shots: s?.shots?.total ?? 0,
    shots_on_target: s?.shots?.on ?? 0,
    passes: s?.passes?.total ?? 0,
  };
}

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

  /** Матчи наших лиг за дату (UTC). Один запрос на дату, кэш 30 минут. */
  async fixturesOn(date: string): Promise<AfFixture[]> {
    const cacheKey = `apifootball:fixtures:${date}`;
    let fixtures = await this.cache.get<AfFixture[]>(cacheKey);
    if (!fixtures) {
      const ours = new Set(this.options.leagues.map((l) => l.leagueId));
      fixtures = (await this.get<AfFixture>("fixtures", { date })).filter((f) => ours.has(String(f.league?.id)));
      await this.cache.set(cacheKey, fixtures, 1800);
    }
    return fixtures;
  }

  /** Статистика всех игроков матча. */
  async fixturePlayers(gameId: string): Promise<FixturePlayerLine[]> {
    const teams = await this.get<AfTeamPlayers>("fixtures/players", { fixture: gameId });
    return teams.flatMap((team) =>
      (team.players ?? []).map((entry) => {
        const s = Array.isArray(entry.statistics) ? entry.statistics[0] : entry.statistics;
        return {
          teamId: team.team.id ?? null,
          playerId: entry.player.id,
          name: entry.player.name,
          minutes: s?.games?.minutes ?? 0,
          stats: statsOf(s),
        };
      }),
    );
  }

  /** Состав команды (кэш 7 дней). */
  async squad(teamId: number): Promise<{ id: number; name: string; position: string | null; number: number | null }[]> {
    const cacheKey = `apifootball:squad:${teamId}`;
    const cached = await this.cache.get<{ id: number; name: string; position: string | null; number: number | null }[]>(cacheKey);
    if (cached) return cached;
    const [entry] = await this.get<{ players: { id: number; name: string; position: string | null; number: number | null }[] }>(
      "players/squads",
      { team: String(teamId) },
    );
    const players = (entry?.players ?? []).map((p) => ({ id: p.id, name: p.name, position: p.position, number: p.number }));
    await this.cache.set(cacheKey, players, 7 * 86_400);
    return players;
  }

  /**
   * Страница итогов сезона по игрокам команды в лиге. Бесплатный тариф: сезоны
   * 2022–2024 и не больше 3 страниц выдачи — поэтому по командам, а не по лиге.
   */
  async seasonPlayersPage(
    teamId: number,
    leagueId: string,
    season: number,
    page: number,
  ): Promise<{ players: SeasonPlayerTotals[]; totalPages: number }> {
    const body = await this.envelope<{ player: { id: number; name: string }; statistics: (AfPlayerStats & { league?: { id: number } })[] }>(
      "players",
      { team: String(teamId), season: String(season), page: String(page) },
    );
    const players = (body.response ?? []).map((entry) => {
      // У перешедших по ходу сезона игроков несколько записей — суммируем по лиге.
      const rows = entry.statistics.filter((st) => String(st.league?.id ?? leagueId) === leagueId);
      const totals: Record<string, number> = { goals: 0, shots: 0, shots_on_target: 0, passes: 0 };
      let appearances = 0;
      let minutes = 0;
      for (const st of rows) {
        appearances += st.games?.appearences ?? 0;
        minutes += st.games?.minutes ?? 0;
        for (const [k, v] of Object.entries(statsOf(st))) totals[k] += v;
      }
      return { playerId: entry.player.id, name: entry.player.name, appearances, minutes, totals };
    });
    return { players, totalPages: body.paging?.total ?? page };
  }

  async findGames(match: AwaitingMatch): Promise<ExternalGame[]> {
    const league = this.options.leagues.find((l) => l.code === match.league_code);
    if (!league) return [];
    const fixtures = await this.fixturesOn(new Date(match.starts_at).toISOString().slice(0, 10));
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

    const players: ExternalPlayerLine[] = (await this.fixturePlayers(gameId)).map((p) => ({
      fullName: p.name,
      didPlay: p.minutes > 0,
      stats: p.minutes > 0 ? p.stats : {},
    }));
    return {
      gameId,
      final: true,
      homeScore: fixture.goals?.home ?? null,
      awayScore: fixture.goals?.away ?? null,
      players,
    };
  }

  /** Сырой матч со статусом и событиями для live-экрана (1 запрос). */
  async getFixtureLive<T>(gameId: string): Promise<T | null> {
    const [fixture] = await this.get<T>("fixtures", { id: gameId });
    return fixture ?? null;
  }

  private async get<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
    return (await this.envelope<T>(endpoint, params)).response ?? [];
  }

  private async envelope<T>(endpoint: string, params: Record<string, string>): Promise<AfEnvelope<T>> {
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
    return body;
  }
}
