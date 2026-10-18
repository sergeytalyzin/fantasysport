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
  hasOdds?: boolean;
  tournamentName?: string;
  categoryName?: string;
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
  participant1Id?: number;
  participant2Id?: number;
  participant1Name?: string;
  participant2Name?: string;
  participant1Abbr?: string;
  participant2Abbr?: string;
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
export const MARKET_TYPE_MAP: Partial<Record<SportId, Record<string, string>>> = {
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
  dota: { kills: "kills" },
  cs: { kills: "kills", headshots: "headshots" },
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
  /** Турнир (классические лиги). */
  tournamentId?: string;
  /**
   * Вид спорта целиком (киберспорт: турниры меняются постоянно).
   * Берутся только матчи с коэффициентами, ближайшие maxFixturesPerLeague.
   */
  opSportId?: string;
  /**
   * Для вида спорта целиком: регулярное выражение по названию турнира.
   * Линии на игроков букмекеры дают только на крупные турниры (проверено:
   * у матчей низших дивизионов CS2 их нет ни у одного букмекера).
   */
  tournamentPattern?: string;
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
  /** Для лиг «вид спорта целиком»: сколько ближайших матчей брать. */
  maxFixturesPerLeague?: number;
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

const SLUGS: Record<string, SportId> = {
  soccer: "football",
  basketball: "basketball",
  tennis: "tennis",
  volleyball: "volleyball",
  handball: "handball",
  baseball: "baseball",
  "american-football": "american_football",
  mma: "mma",
  boxing: "boxing",
  "table-tennis": "table_tennis",
  rugby: "rugby",
  cricket: "cricket",
  futsal: "futsal",
  darts: "darts",
  snooker: "snooker",
  "esport-dota": "dota",
  "esport-counter-strike": "cs",
  "esport-league-of-legends": "lol",
  "esport-valorant": "valorant",
};

/**
 * Виртуальные и симулированные турниры (например, «Simulated Reality League»,
 * eSoccer) — не реальные события, на сайт они не попадают.
 */
export const VIRTUAL_TOURNAMENT = /simulat|virtual|\bsrl\b|esoccer|e-soccer|ebasketball|cyber|fifa\b|efootball/i;

export function isVirtualFixture(f: { tournamentName?: string; categoryName?: string }): boolean {
  return VIRTUAL_TOURNAMENT.test(`${f.categoryName ?? ""} ${f.tournamentName ?? ""}`);
}

export interface ScheduleData {
  leagues: { tournament_id: string; sport_id: SportId; name: string; country: string | null }[];
  teams: ProviderTeam[];
  matches: (ProviderMatch & { tournamentId: string })[];
}

function sportFromSlug(slug: string): SportId | null {
  if (SLUGS[slug]) return SLUGS[slug];
  if (slug === "basketball") return "basketball";
  if (slug.includes("hockey")) return "hockey";
  return null;
}

/** Турниры первого эшелона, на которые букмекеры выставляют линии на игроков. */
export const TIER1_ESPORTS =
  "IEM|Intel Extreme|BLAST|ESL Pro League|PGL|Major|The International|DreamLeague|Riyadh|Esports World Cup|BetBoom|FISSURE|Perfect World|StarLadder|Thunderpick World|ESL One";

/**
 * Порядок запроса коэффициентов: ближайшие матчи по очереди из каждой лиги,
 * чтобы при малом бюджете запросов одна лига (например, киберспорт с десятками
 * матчей) не вытесняла остальные.
 */
export function roundRobinByLeague(
  ids: string[],
  fixtures: Map<string, { fixture: { startTime: string }; league: { code: string } }>,
): string[] {
  const groups = new Map<string, string[]>();
  const sorted = [...ids].sort((a, b) =>
    (fixtures.get(a)?.fixture.startTime ?? "").localeCompare(fixtures.get(b)?.fixture.startTime ?? ""),
  );
  for (const id of sorted) {
    const code = fixtures.get(id)?.league.code ?? "";
    groups.set(code, [...(groups.get(code) ?? []), id]);
  }
  const queues = [...groups.values()];
  const result: string[] = [];
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) result.push(next);
    }
  }
  return result;
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
  /** Английские названия команд из ответов /odds (для сопоставления с источниками результатов). */
  private readonly teamNamesEn = new Map<string, { name_en: string; abbr_en: string | null }>();

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
        if (!league.tournamentId) {
          result.push({ code: league.code, sportId: sport.id, externalId: sport.externalId, name: sport.name });
          continue;
        }
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
      const scope: Record<string, string> | null = league.tournamentId
        ? { tournamentId: league.tournamentId }
        : league.opSportId
          ? { sportId: league.opSportId }
          : null;
      if (!scope) continue;
      let fixtures: OpFixture[];
      try {
        fixtures = await this.request<OpFixture[]>("fixtures", {
          ...scope,
          // Окно округляется до часа, чтобы повторные запуски попадали в кэш.
          from: hourFloor(range.from),
          to: hourFloor(range.to),
        });
      } catch (e) {
        // «Матчей не найдено» (404 FIXTURE_NOT_FOUND) — не ошибка: у лиги просто нет матчей в окне.
        if (e instanceof ProviderHttpError && e.status === 404) continue;
        throw e;
      }
      if (!league.tournamentId) {
        // Вид спорта целиком: только матчи с коэффициентами, ближайшие по времени.
        const pattern = new RegExp(league.tournamentPattern ?? TIER1_ESPORTS, "i");
        fixtures = fixtures
          .filter((f) => f.hasOdds !== false && pattern.test(f.tournamentName ?? ""))
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .slice(0, this.options.maxFixturesPerLeague ?? 20);
      }
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

  /**
   * Полное расписание вида спорта за окно дат: все реальные турниры, один запрос.
   * Виртуальные турниры отбрасываются. 404 «матчей не найдено» — пустой список.
   */
  async getSchedule(opSportId: string, sportId: SportId, range: DateRange): Promise<ScheduleData> {
    let fixtures: OpFixture[];
    try {
      // Названия турниров и команд — на русском (для пользователей).
      fixtures = await this.request<OpFixture[]>("fixtures", {
        sportId: opSportId,
        from: hourFloor(range.from),
        to: hourFloor(range.to),
        language: "ru",
      });
    } catch (e) {
      if (e instanceof ProviderHttpError && e.status === 404) return { leagues: [], teams: [], matches: [] };
      throw e;
    }
    const leagues = new Map<string, ScheduleData["leagues"][number]>();
    const teams = new Map<string, ProviderTeam>();
    const matches: ScheduleData["matches"] = [];
    for (const f of fixtures) {
      if (isVirtualFixture(f) || !f.participant1Name || !f.participant2Name) continue;
      const tournamentId = String(f.tournamentId);
      leagues.set(tournamentId, {
        tournament_id: tournamentId,
        sport_id: sportId,
        name: f.tournamentName ?? `Турнир ${tournamentId}`,
        country: f.categoryName ?? null,
      });
      const home = this.team(f, 1, sportId);
      const away = this.team(f, 2, sportId);
      teams.set(home.externalId, home);
      teams.set(away.externalId, away);
      matches.push({
        externalId: f.fixtureId,
        tournamentId,
        leagueCode: "",
        homeTeamExternalId: home.externalId,
        awayTeamExternalId: away.externalId,
        startsAt: new Date(f.startTime).toISOString(),
        status: STATUS[f.statusId] ?? "SCHEDULED",
      });
    }
    return { leagues: [...leagues.values()], teams: [...teams.values()], matches };
  }

  /**
   * Английские названия всех участников вида спорта (GET /v4/participants?sportId&language=en):
   * { "3409": "Chicago Bulls", … }. Один запрос на вид спорта; расписание загружается на русском,
   * а сопоставление с источниками статистики идёт по английским названиям.
   */
  async participantNamesEn(opSportId: string): Promise<{ external_id: string; name_en: string }[]> {
    const data = await this.request<Record<string, string>>("participants", { sportId: opSportId, language: "en" });
    return Object.entries(data ?? {})
      .filter(([, name]) => typeof name === "string" && name.trim())
      .map(([id, name]) => ({ external_id: `oddspapi:participant:${id}`, name_en: name.trim() }));
  }

  getTeamNamesEn(): { external_id: string; name_en: string; abbr_en: string | null }[] {
    return [...this.teamNamesEn.entries()].map(([external_id, v]) => ({ external_id, ...v }));
  }

  /** Матчи из нашей БД, для которых нужно запросить линии (без повторного запроса расписания). */
  primeFixtures(list: { externalId: string; leagueCode: string; sportId: SportId; startsAt: string }[]) {
    for (const m of list) {
      this.fixtures.set(m.externalId, {
        fixture: { fixtureId: m.externalId, startTime: m.startsAt } as OpFixture,
        league: { code: m.leagueCode, sportId: m.sportId },
      });
    }
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
      const code = sportId ? MARKET_TYPE_MAP[sportId]?.[market.marketType.slice("playertotals-".length)] : undefined;
      if (!sportId || !code) continue;
      const side: Record<string, "over" | "under"> = {};
      for (const o of market.outcomes) {
        const name = o.outcomeName.toLowerCase();
        if (name === "over" || name === "under") side[String(o.outcomeId)] = name;
      }
      if (Object.keys(side).length === 2) markets.set(String(market.marketId), { code, sportId, line: market.handicap, side });
    }

    // Ближайшие матчи — в первую очередь.
    const ordered = roundRobinByLeague(matchExternalIds, this.fixtures);
    const props: ProviderPlayerProp[] = [];
    for (const fixtureId of ordered.slice(0, this.options.maxFixturesPerRun ?? 25)) {
      let odds: OpOdds;
      try {
        odds = await this.request<OpOdds>("odds", { fixtureId, bookmakers: this.bookmakers.join(",") });
      } catch (e) {
        if (e instanceof OddsPapiBudgetError) break;
        throw e;
      }
      for (const n of [1, 2] as const) {
        const id = n === 1 ? odds.participant1Id : odds.participant2Id;
        const name = n === 1 ? odds.participant1Name : odds.participant2Name;
        if (id && name) {
          this.teamNamesEn.set(`oddspapi:participant:${id}`, {
            name_en: name,
            abbr_en: (n === 1 ? odds.participant1Abbr : odds.participant2Abbr) ?? null,
          });
        }
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
