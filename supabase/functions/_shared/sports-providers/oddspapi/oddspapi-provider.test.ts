import { describe, expect, it } from "vitest";
import { ProviderCapabilityError, ProviderHttpError } from "../types.ts";
import { normalizePlayerName, OddsPapiBudgetError, OddsPapiProvider } from "./oddspapi-provider.ts";

// Структура повторяет реальные ответы OddsPapi v4 (проверено scripts/oddspapi-probe.mjs).
const overUnder = (over: number, under: number) => [
  { outcomeId: over, outcomeName: "Over" },
  { outcomeId: under, outcomeName: "Under" },
];

const market = (marketId: number, marketType: string, period: string, handicap: number, sportId = 11) => ({
  marketId,
  marketName: marketType,
  playerProp: true,
  sportId,
  handicap,
  period,
  marketType,
  outcomes: overUnder(marketId * 10 + 1, marketId * 10 + 2),
});

const player = (name: string, price: number, active = true) => ({ playerName: name, price, active });

// Цены Over/Under для линии: { "<marketId>": { "<playerId>": [over, under] } }
function bookmakerMarkets(lines: Record<number, Record<string, [number, number, boolean?]>>, names: Record<string, string>) {
  const markets: Record<string, unknown> = {};
  for (const [marketId, players] of Object.entries(lines)) {
    const overId = Number(marketId) * 10 + 1;
    const underId = Number(marketId) * 10 + 2;
    const over: Record<string, unknown> = {};
    const under: Record<string, unknown> = {};
    for (const [pid, [o, u, active]] of Object.entries(players)) {
      over[pid] = player(names[pid], o, active ?? true);
      under[pid] = player(names[pid], u, active ?? true);
    }
    markets[marketId] = { outcomes: { [overId]: { players: over }, [underId]: { players: under } } };
  }
  return markets;
}

const NAMES = { "2068637": "Cunningham, Cade", "777": "Antetokounmpo, Giannis" };

const responses: Record<string, unknown> = {
  sports: [
    { sportId: 10, slug: "soccer", sportName: "Soccer" },
    { sportId: 11, slug: "basketball", sportName: "Basketball" },
    { sportId: 15, slug: "ice-hockey", sportName: "Ice Hockey" },
  ],
  tournaments: [{ tournamentId: 132, tournamentSlug: "nba", tournamentName: "NBA", categorySlug: "usa", categoryName: "USA" }],
  fixtures: [
    {
      fixtureId: "id1000",
      participant1Id: 3409,
      participant2Id: 3410,
      participant1Name: "Detroit Pistons",
      participant2Name: "Boston Celtics",
      participant1Abbr: "DET",
      participant2Abbr: "BOS",
      sportId: 11,
      tournamentId: 132,
      statusId: 0,
      startTime: "2026-10-20T19:00:00Z",
    },
  ],
  markets: [
    market(5001, "playertotals-points", "result", 24.5),
    market(5002, "playertotals-points", "result", 25.5),
    market(5003, "playertotals-ptsassreb", "result", 38.5),
    // Первая четверть — не полный матч, игнорируется.
    market(5004, "playertotals-points", "p1", 6.5),
    // Рынок без соответствия в нашей БД.
    market(5005, "playertotals-blocks", "result", 1.5),
    { marketId: 101, marketName: "Full Time Result", playerProp: false, sportId: 10, handicap: 0, period: "result", marketType: "1x2", outcomes: [{ outcomeId: 101, outcomeName: "1" }] },
  ],
  odds: {
    fixtureId: "id1000",
    bookmakerOdds: {
      williamhill: {
        bookmakerIsActive: true,
        markets: bookmakerMarkets(
          {
            5001: { "2068637": [1.55, 2.4] },
            5002: { "2068637": [1.9, 1.9] }, // самая сбалансированная → основная линия 25.5
            5003: { "777": [1.87, 1.93] },
            5004: { "2068637": [1.9, 1.9] },
            5005: { "777": [1.9, 1.9] },
          },
          NAMES,
        ),
      },
      betway: {
        bookmakerIsActive: true,
        markets: bookmakerMarkets({ 5002: { "2068637": [1.85, 1.95] } }, NAMES),
      },
      stale: {
        bookmakerIsActive: true,
        // Неактивные исходы не учитываются.
        markets: bookmakerMarkets({ 5001: { "2068637": [1.9, 1.9, false] } }, NAMES),
      },
    },
  },
};

function mockFetch(calls: string[], status = 200): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const endpoint = new URL(url).pathname.split("/").pop()!;
    return new Response(JSON.stringify(responses[endpoint] ?? []), { status });
  }) as typeof fetch;
}

const create = (calls: string[], extra: Partial<ConstructorParameters<typeof OddsPapiProvider>[0]> = {}, status = 200) =>
  new OddsPapiProvider({
    apiKey: "secret-key",
    leagues: [{ code: "NBA", sportId: "basketball", tournamentId: "132" }],
    bookmakers: ["williamhill", "betway"],
    fetch: mockFetch(calls, status),
    throttle: false,
    ...extra,
  });

describe("OddsPapiProvider", () => {
  it("передаёт ключ query-параметром apiKey", async () => {
    const calls: string[] = [];
    await create(calls).getSports();
    expect(calls[0]).toBe("https://api.oddspapi.io/v4/sports?apiKey=secret-key");
  });

  it("сопоставляет виды спорта и настроенные турниры", async () => {
    const p = create([]);
    expect((await p.getSports()).map((s) => s.id)).toEqual(["football", "basketball", "hockey"]);
    expect(await p.getLeagues()).toEqual([{ code: "NBA", sportId: "basketball", externalId: "132", name: "NBA" }]);
  });

  it("participant1 — хозяева", async () => {
    const calls: string[] = [];
    const { matches, teams } = await create(calls).getMatches({
      from: new Date("2026-10-17T00:00:00Z"),
      to: new Date("2026-10-20T00:00:00Z"),
    });
    expect(calls[0]).toContain("/fixtures?from=2026-10-17T00%3A00%3A00Z&to=2026-10-20T00%3A00%3A00Z&tournamentId=132");
    expect(matches[0]).toMatchObject({
      externalId: "id1000",
      homeTeamExternalId: "oddspapi:participant:3409",
      awayTeamExternalId: "oddspapi:participant:3410",
      status: "SCHEDULED",
    });
    expect(teams.map((t) => t.abbr)).toEqual(["DET", "BOS"]);
  });

  it("выбирает консенсусную линию полного матча и отбрасывает лишнее", async () => {
    const calls: string[] = [];
    const p = create(calls);
    await p.getMatches({ from: new Date(), to: new Date() });
    const props = await p.getPlayerProps({ matchExternalIds: ["id1000"] });
    expect(props).toEqual([
      { matchExternalId: "id1000", playerExternalId: "oddspapi:player:2068637", marketCode: "points", line: 25.5 },
      { matchExternalId: "id1000", playerExternalId: "oddspapi:player:777", marketCode: "pts_reb_ast", line: 38.5 },
    ]);
    expect(calls.some((c) => c.includes("/odds?bookmakers=williamhill%2Cbetway&fixtureId=id1000"))).toBe(true);
    expect((await p.getPlayers()).map((x) => x.fullName)).toEqual(["Cade Cunningham", "Giannis Antetokounmpo"]);
  });

  it("соблюдает бюджет запросов на запуск", async () => {
    const calls: string[] = [];
    // sports + markets + odds = 3 запроса; при бюджете 2 коэффициенты не запрашиваются.
    const p = create(calls, { maxRequestsPerRun: 2 });
    expect(await p.getPlayerProps({ matchExternalIds: ["id1000"] })).toEqual([]);
    expect(calls).toHaveLength(2);
    // Любой следующий сетевой запрос в этом запуске отклоняется.
    await expect(p.getSports()).rejects.toBeInstanceOf(OddsPapiBudgetError);
  });

  it("при 429 ждёт retryMs и повторяет запрос один раз", async () => {
    let attempts = 0;
    const p = new OddsPapiProvider({
      apiKey: "k",
      leagues: [],
      throttle: false,
      fetch: (async () => {
        attempts++;
        return attempts === 1
          ? new Response(JSON.stringify({ error: { code: "RATE_LIMITED", retryMs: 10 } }), { status: 429 })
          : new Response(JSON.stringify(responses.sports), { status: 200 });
      }) as typeof fetch,
    });
    expect(await p.getSports()).toHaveLength(3);
    expect(attempts).toBe(2);
  });

  it("окно матчей округляется до часа (для кэша)", async () => {
    const calls: string[] = [];
    await create(calls).getMatches({ from: new Date("2026-10-17T15:42:36.123Z"), to: new Date("2026-10-19T15:42:36Z") });
    expect(calls[0]).toContain("from=2026-10-17T15%3A00%3A00Z&to=2026-10-19T15%3A00%3A00Z");
  });

  it("404 «матчей не найдено» по одной лиге не мешает остальным", async () => {
    const p = new OddsPapiProvider({
      apiKey: "k",
      leagues: [
        { code: "DOTA2", sportId: "dota", opSportId: "16" },
        { code: "NBA", sportId: "basketball", tournamentId: "132" },
      ],
      throttle: false,
      fetch: (async (input: RequestInfo | URL) =>
        String(input).includes("sportId=16")
          ? new Response(JSON.stringify({ error: { code: "FIXTURE_NOT_FOUND" } }), { status: 404 })
          : new Response(JSON.stringify(responses.fixtures), { status: 200 })) as typeof fetch,
    });
    const { matches } = await p.getMatches({ from: new Date(), to: new Date() });
    expect(matches.map((m) => m.leagueCode)).toEqual(["NBA"]);
  });

  it("киберспорт: только турниры первого эшелона", async () => {
    const fixture = (id: string, tournamentName: string) => ({ ...(responses.fixtures as object[])[0], fixtureId: id, tournamentName, sportId: 17 });
    const p = new OddsPapiProvider({
      apiKey: "k",
      leagues: [{ code: "CS2", sportId: "cs", opSportId: "17" }],
      throttle: false,
      fetch: (async () =>
        new Response(JSON.stringify([fixture("a", "IEM Chengdu"), fixture("b", "Elisa BreakOut Series"), fixture("c", "BLAST Premier")]), {
          status: 200,
        })) as typeof fetch,
    });
    const { matches } = await p.getMatches({ from: new Date(), to: new Date() });
    expect(matches.map((m) => m.externalId)).toEqual(["a", "c"]);
  });

  it("не отдаёт статистику спортсменов", async () => {
    await expect(create([]).getPlayerStats()).rejects.toBeInstanceOf(ProviderCapabilityError);
  });

  it("скрывает ключ в тексте ошибки HTTP", async () => {
    const error = await create([], {}, 401).getSports().catch((e) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.message).not.toContain("secret-key");
  });

  it("использует кэш и не делает повторный запрос", async () => {
    const calls: string[] = [];
    const store = new Map<string, unknown>();
    const p = create(calls, {
      cache: {
        get: async <T,>(key: string) => (store.get(key) as T) ?? null,
        set: async (key, value) => void store.set(key, value),
      },
    });
    await p.getSports();
    await p.getSports();
    expect(calls).toHaveLength(1);
  });

  it("normalizePlayerName", () => {
    expect(normalizePlayerName("Cunningham, Cade")).toBe("Cade Cunningham");
    expect(normalizePlayerName("LeBron James")).toBe("LeBron James");
  });

  it("ошибка бюджета различима", () => {
    expect(new OddsPapiBudgetError(5).message).toContain("5");
  });
});
