// OddsPapi (https://oddspapi.io/en/docs) — источник линий (player props).
//
// Используются только задокументированные эндпоинты v4:
//   GET /sports, /tournaments?sportId, /fixtures?tournamentId&from&to,
//   GET /markets, /odds?fixtureId&bookmakers
// Ключ передаётся query-параметром apiKey. Паузы между запросами соответствуют
// «Endpoint cooldown» из документации.
//
// Фактической статистики спортсменов OddsPapi не отдаёт (/scores содержит
// только счёт команд), поэтому capabilities.results = false: результаты
// берутся из другого провайдера или вводятся администратором.
//
// Проверено на реальных ответах (scripts/oddspapi-probe.mjs, октябрь 2026):
//  - participant1 — хозяева;
//  - player props «больше/меньше» — рынки с marketType "playertotals-*" и
//    исходами Over/Under; полный матч — period "result" или "fulltime+overtime";
//  - флаг mainLine букмекеры не выставляют, поэтому основная линия выбирается
//    по консенсусу: самая сбалансированная пара цен Over/Under;
//  - без фильтра bookmakers ответ /odds весит десятки мегабайт;
//  - бесплатный план: 250 запросов (период в API не указан) — бюджет на запуск
//    ограничивается maxRequestsPerRun.

import {
  type DateRange,
  type LeagueCode,
  type MatchStatus,
  noopCache,
  type ProviderCache,
  ProviderCapabilityError,
  ProviderHttpError,
  type ProviderLeague,
  type ProviderMatch,
  type ProviderMatchResult,
  type ProviderPlayer,
  type ProviderPlayerProp,
  type ProviderSport,
  type ProviderTeam,
  type SportId,
  type SportsDataProvider,
} from "../types.ts";

// --- Поля ответов из документации -----------------------------------------
interface OpSport {
  sportId: number;
  slug: string;
  sportName: string;
}

interface OpTournament {
  tournamentId: number;
  tournamentSlug: string;
  tournamentName: string;
  categoryName: string;
}

interface OpFixture {
  fixtureId: string;
  participant1Id: number;
  participant2Id: number;
  participant1Name: string;
  participant2Name: string;
  participant1ShortName?: string;
  participant2ShortName?: string;
  participant1Abbr?: string;
  participant2Abbr?: string;
  sportId: number;
  tournamentId: number;
  statusId: number;
  startTime: string;
}

interface OpMarket {
  marketId: number;
  marketName: string;
  playerProp: boolean;
  sportId: number;
  handicap: number;
  period?: string;
  marketType?: string;
  outcomes: { outcomeId: number; outcomeName: string }[];
}

interface OpOddsPlayer {
  active?: boolean;
  playerName?: string | null;
  price?: number | null;
}

interface OpOdds {
  fixtureId: string;
  bookmakerOdds?: Record<
    string,
    {
      bookmakerIsActive?: boolean;
      markets?: Record<string, { marketActive?: boolean; outcomes?: Record<string, { players?: Record<string, OpOddsPlayer> }> }>;
    }
  >;
}

// ---------------------------------------------------------------------------
/** marketType без префикса "playertotals-" → код рынка в нашей БД. */
export const MARKET_TYPE_MAP: Record<SportId, Record<string, string>> = {
  basketball: {
    points: "points",
    rebounds: "rebounds",
    assists: "assists",
    "3pointers": "threes",
    ptsassreb: "pts_reb_ast",
    ptsreb: "pts_reb",
    ptsass: "pts_ast",
  },
  hockey: {
    goals: "goals",
    assists: "assists",
    points: "points",
    shotsongoal: "shots_on_goal",
    saves: "saves",
  },
  football: {
    goals: "goals",
    shots: "shots",
    shotsongoal: "shots_on_target",
  },
};

const FULL_GAME_PERIODS = new Set(["result", "fulltime+overtime"]);

/** Букмекеры с хорошим покрытием player props по НХЛ, АПЛ и НБА (проверено). */
export const DEFAULT_BOOKMAKERS = [
  "williamhill", "betway", "bet99", "espnbet", "888sport", "pinnacle",
  "1xbet", "betsson", "unibet", "draftkings",
];

export interface OddsPapiLeagueConfig {
  code: LeagueCode;
  sportId: SportId;
  tournamentId: string;
}

export interface OddsPapiOptions {
  apiKey: string;
  leagues: OddsPapiLeagueConfig[];
  baseUrl?: string;
  bookmakers?: string[];
  cache?: ProviderCache;
  fetch?: typeof fetch;
  /** Пауза между запросами (мс); 0 — в тестах. */
  throttle?: boolean;
  maxFixturesPerRun?: number;
  /** Максимум сетевых запросов за запуск (кэш не считается). */
  maxRequestsPerRun?: number;
}

export class OddsPapiBudgetError extends Error {
  constructor(limit: number) {
    super(`Исчерпан бюджет запросов OddsPapi на запуск (${limit})`);
    this.name = "OddsPapiBudgetError";
  }
}

// Cooldown эндпоинтов из документации, мс.
const COOLDOWN: Record<string, number> = {
  sports: 1000,
  tournaments: 1000,
  fixtures: 2000,
  markets: 1000,
  odds: 500,
};

// Время жизни кэша, секунды.
const CACHE_TTL: Record<string, number> = {
  sports: 86_400,
  tournaments: 86_400,
  markets: 86_400,
  fixtures: 600,
  odds: 300,
};

const STATUS: Record<number, MatchStatus> = {
  0: "SCHEDULED",
  1: "LIVE",
  2: "FINISHED",
  3: "CANCELLED",
};

/** «Cunningham, Cade» → «Cade Cunningham». */
export function normalizePlayerName(name: string): string {
  const parts = name.split(",").map((p) => p.trim());
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : name.trim();
}

function sportFromSlug(slug: string): SportId | null {
  if (slug === "soccer") return "football";
  if (slug === "basketball") return "basketball";
  if (slug.includes("hockey")) return "hockey";
  return null;
}

const hourFloor = (d: Date) => `${d.toISOString().slice(0, 13)}:00:00Z`;

const abbr = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3).toUpperCase();

export class OddsPapiProvider implements SportsDataProvider {
  readonly id = "oddspapi";
  readonly capabilities = { lines: true, results: false };

  private readonly baseUrl: string;
  private readonly cache: ProviderCache;
  private readonly fetchImpl: typeof fetch;
  private readonly bookmakers: string[];
  private requests = 0;
  private readonly lastCall = new Map<string, number>();
  private readonly fixtures = new Map<string, { fixture: OpFixture; league: OddsPapiLeagueConfig }>();
  private readonly players = new Map<string, ProviderPlayer>();

  constructor(private readonly options: OddsPapiOptions) {
    if (!options.apiKey) throw new Error("ODDSPAPI_API_KEY не задан");
    this.baseUrl = (options.baseUrl ?? "https://api.oddspapi.io/v4").replace(/\/$/, "");
    this.cache = options.cache ?? noopCache;
    this.fetchImpl = options.fetch ?? fetch;
    this.bookmakers = options.bookmakers?.length ? options.bookmakers : DEFAULT_BOOKMAKERS;
  }

  async getSports(): Promise<ProviderSport[]> {
    const sports = await this.request<OpSport[]>("sports", {});
    return sports.flatMap((s) => {
      const id = sportFromSlug(s.slug);
      return id ? [{ id, externalId: String(s.sportId), name: s.sportName }] : [];
    });
  }

  async getLeagues(): Promise<ProviderLeague[]> {
    const sports = await this.getSports();
    const result: ProviderLeague[] = [];
    for (const sport of sports) {
      const configured = this.options.leagues.filter((l) => l.sportId === sport.id);
      if (configured.length === 0) continue;
      const tournaments = await this.request<OpTournament[]>("tournaments", { sportId: sport.externalId });
      for (const league of configured) {
        const t = tournaments.find((x) => String(x.tournamentId) === league.tournamentId);
        if (t) {
          result.push({ code: league.code, sportId: sport.id, externalId: league.tournamentId, name: t.tournamentName });
        }
      }
    }
    return result;
  }

  async getMatches(range: DateRange): Promise<{ matches: ProviderMatch[]; teams: ProviderTeam[] }> {
    const matches: ProviderMatch[] = [];
    const teams = new Map<string, ProviderTeam>();
    for (const league of this.options.leagues) {
      const fixtures = await this.request<OpFixture[]>("fixtures", {
        tournamentId: league.tournamentId,
        // Окно округляется до часа, чтобы повторные запуски попадали в кэш.
        from: hourFloor(range.from),
        to: hourFloor(range.to),
      });
      for (const f of fixtures) {
        this.fixtures.set(f.fixtureId, { fixture: f, league });
        const home = this.team(f, 1, league.sportId);
        const away = this.team(f, 2, league.sportId);
        teams.set(home.externalId, home);
        teams.set(away.externalId, away);
        matches.push({
          externalId: f.fixtureId,
          leagueCode: league.code,
          homeTeamExternalId: home.externalId,
          awayTeamExternalId: away.externalId,
          startsAt: new Date(f.startTime).toISOString(),
          status: STATUS[f.statusId] ?? "SCHEDULED",
        });
      }
    }
    return { matches, teams: [...teams.values()] };
  }

  /** Игроки известны только из коэффициентов: вызывайте после getPlayerProps. */
  async getPlayers(): Promise<ProviderPlayer[]> {
    return [...this.players.values()];
  }

  async getPlayerProps({ matchExternalIds }: { matchExternalIds: string[] }): Promise<ProviderPlayerProp[]> {
    const sportByOpId = new Map((await this.getSports()).map((sp) => [sp.externalId, sp.id]));
    const catalog = await this.request<OpMarket[]>("markets", {});
    const markets = new Map<string, { code: string; sportId: SportId; line: number; side: Record<string, "over" | "under"> }>();
    for (const market of catalog) {
      if (!market.playerProp || !market.marketType?.startsWith("playertotals-")) continue;
      if (!FULL_GAME_PERIODS.has(market.period ?? "")) continue;
      const sportId = sportByOpId.get(String(market.sportId));
      const code = sportId ? MARKET_TYPE_MAP[sportId][market.marketType.slice("playertotals-".length)] : undefined;
      if (!sportId || !code) continue;
      const side: Record<string, "over" | "under"> = {};
      for (const o of market.outcomes) {
        const name = o.outcomeName.toLowerCase();
        if (name === "over" || name === "under") side[String(o.outcomeId)] = name;
      }
      if (Object.keys(side).length === 2) markets.set(String(market.marketId), { code, sportId, line: market.handicap, side });
    }

    // Ближайшие матчи — в первую очередь.
    const ordered = [...matchExternalIds].sort((a, b) =>
      (this.fixtures.get(a)?.fixture.startTime ?? "").localeCompare(this.fixtures.get(b)?.fixture.startTime ?? ""),
    );
    const props: ProviderPlayerProp[] = [];
    for (const fixtureId of ordered.slice(0, this.options.maxFixturesPerRun ?? 25)) {
      let odds: OpOdds;
      try {
        odds = await this.request<OpOdds>("odds", { fixtureId, bookmakers: this.bookmakers.join(",") });
      } catch (e) {
        if (e instanceof OddsPapiBudgetError) break;
        throw e;
      }
      props.push(...this.consensusLines(fixtureId, odds, markets));
    }
    return props;
  }

  /**
   * Для каждого спортсмена и показателя выбирает одну линию: ту, где цены
   * Over и Under у букмекеров ближе всего (минимальный |ln(over) − ln(under)|),
   * при равенстве — линию, которую предлагает больше букмекеров.
   */
  private consensusLines(
    fixtureId: string,
    odds: OpOdds,
    markets: Map<string, { code: string; sportId: SportId; line: number; side: Record<string, "over" | "under"> }>,
  ): ProviderPlayerProp[] {
    const known = this.fixtures.get(fixtureId);
    // ключ спортсмен|рынок → линия → суммарный дисбаланс и число букмекеров
    const candidates = new Map<string, Map<number, { imbalance: number; books: number }>>();
    for (const bookmaker of Object.values(odds.bookmakerOdds ?? {})) {
      if (bookmaker.bookmakerIsActive === false) continue;
      for (const [marketId, market] of Object.entries(bookmaker.markets ?? {})) {
        const meta = markets.get(marketId);
        if (!meta || (known && meta.sportId !== known.league.sportId)) continue;
        const prices = new Map<string, { name: string; over?: number; under?: number }>();
        for (const [outcomeId, outcome] of Object.entries(market.outcomes ?? {})) {
          const side = meta.side[outcomeId];
          if (!side) continue;
          for (const [playerId, player] of Object.entries(outcome.players ?? {})) {
            if (playerId === "0" || !player.playerName || player.active === false || !player.price) continue;
            const entry = prices.get(playerId) ?? { name: player.playerName };
            entry[side] = player.price;
            prices.set(playerId, entry);
          }
        }
        for (const [playerId, p] of prices) {
          if (!p.over || !p.under) continue;
          const externalId = `oddspapi:player:${playerId}`;
          this.players.set(externalId, {
            externalId,
            sportId: meta.sportId,
            teamExternalId: null,
            fullName: normalizePlayerName(p.name),
          });
          const key = `${playerId}|${meta.code}`;
          const lines = candidates.get(key) ?? new Map();
          const current = lines.get(meta.line) ?? { imbalance: 0, books: 0 };
          lines.set(meta.line, {
            imbalance: current.imbalance + Math.abs(Math.log(p.over) - Math.log(p.under)),
            books: current.books + 1,
          });
          candidates.set(key, lines);
        }
      }
    }

    const result: ProviderPlayerProp[] = [];
    for (const [key, lines] of candidates) {
      const [playerId, marketCode] = key.split("|");
      const best = [...lines.entries()]
        .filter(([line]) => line > 0 && Number.isInteger(line * 2))
        .sort(([, a], [, b]) => a.imbalance / a.books - b.imbalance / b.books || b.books - a.books)[0];
      if (best) result.push({ matchExternalId: fixtureId, playerExternalId: `oddspapi:player:${playerId}`, marketCode, line: best[0] });
    }
    return result;
  }

  async getPlayerStats(): Promise<ProviderMatchResult | null> {
    throw new ProviderCapabilityError(this.id, "статистика спортсменов");
  }

  private team(f: OpFixture, n: 1 | 2, sportId: SportId): ProviderTeam {
    const name = n === 1 ? f.participant1Name : f.participant2Name;
    const shortName = (n === 1 ? f.participant1ShortName : f.participant2ShortName) || name;
    return {
      externalId: `oddspapi:participant:${n === 1 ? f.participant1Id : f.participant2Id}`,
      sportId,
      name,
      shortName,
      abbr: ((n === 1 ? f.participant1Abbr : f.participant2Abbr) || abbr(shortName)).slice(0, 4),
    };
  }

  private async request<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
    const cacheKey = `oddspapi:${endpoint}?${query}`;
    const cached = await this.cache.get<T>(cacheKey);
    if (cached !== null) return cached;

    const limit = this.options.maxRequestsPerRun;
    if (limit !== undefined && this.requests >= limit) throw new OddsPapiBudgetError(limit);
    this.requests++;

    query.set("apiKey", this.options.apiKey);
    const url = `${this.baseUrl}/${endpoint}?${query}`;
    let response = await this.send(endpoint, url);
    if (response.status === 429) {
      // Сервер сообщает, сколько ждать (retryMs); повторяем один раз.
      const body = (await response.json().catch(() => null)) as { error?: { retryMs?: number } } | null;
      await new Promise((r) => setTimeout(r, (body?.error?.retryMs ?? 1000) + 250));
      response = await this.send(endpoint, url);
    }
    if (!response.ok) {
      throw new ProviderHttpError(this.id, response.status, url.replace(this.options.apiKey, "***"), await response.text());
    }
    const data = (await response.json()) as T;
    await this.cache.set(cacheKey, data, CACHE_TTL[endpoint] ?? 300);
    return data;
  }

  /** Пауза отсчитывается от окончания предыдущего запроса, с запасом. */
  private async send(endpoint: string, url: string): Promise<Response> {
    if (this.options.throttle !== false) {
      const wait = (this.lastCall.get(endpoint) ?? 0) + (COOLDOWN[endpoint] ?? 1000) + 250 - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    try {
      return await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    } finally {
      this.lastCall.set(endpoint, Date.now());
    }
  }
}
