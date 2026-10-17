// Edge Function: синхронизация реальных спортивных данных.
//
// POST /functions/v1/sports-sync
//   {"action": "sync"}                       — линии + результаты (Cron, каждые 15 минут)
//   {"action": "lines" | "results"}          — только линии / только результаты
//   {"action": "logos"}                      — логотипы команд (Cron, каждые 10 минут)
//   {"action": "photos"}                     — фото спортсменов (Cron, каждые 10 минут)
//   {"action": "status"}                     — состояние провайдеров
//
// Доступ: заголовок x-cron-secret (Cron) или JWT администратора.
// Ключи внешних API хранятся только в Supabase Secrets.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { StatLine } from "../_shared/house-lines/engine.ts";
import { HOUSE_SOURCE, type HouseSink, syncHouseLines } from "../_shared/house-lines/sync-house.ts";
import {
  type ApiFootballLeague,
  ApiFootballResultsProvider,
  type AwaitingMatch,
  type ExternalResultsSink,
  type LeagueCode,
  NhlResultsProvider,
  OpenDotaResultsProvider,
  type PropsCandidate,
  type ResultsProvider,
  type ScheduleSink,
  type SportId,
  syncPropsForMatches,
  syncSchedule,
  TIER1_ESPORTS,
  syncExternalResults,
  type OddsPapiLeagueConfig,
  OddsPapiProvider,
  type ProviderCache,
  type SportsDataProvider,
  type SyncSink,
} from "../_shared/sports-providers/index.ts";
import { type PhotoCandidate, type PhotosSink, syncPlayerPhotos } from "../_shared/player-photos/player-photos.ts";
import { type LogoCandidate, type LogosSink, syncTeamLogos } from "../_shared/team-logos/team-logos.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

async function authorize(req: Request, db: SupabaseClient): Promise<"cron" | "admin" | null> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return "cron";

  // JWT пользователя проверяется сервером Auth, роль — в таблице profiles.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await db.from("profiles").select("role").eq("id", data.user.id).single();
  return profile?.role === "admin" ? "admin" : null;
}

function createSink(db: SupabaseClient): SyncSink {
  return {
    async ingestSlate(source, payload) {
      const { data, error } = await db.rpc("ingest_slate", { p_source: source, p_payload: payload });
      if (error) throw new Error(`ingest_slate: ${error.message}`);
      return data;
    },
    async ingestResults(source, payload) {
      const { data, error } = await db.rpc("ingest_results", { p_source: source, p_payload: payload });
      if (error) throw new Error(`ingest_results: ${error.message}`);
      return data;
    },
    async setTeamNamesEn(source, items) {
      const { data, error } = await db.rpc("set_team_names_en", { p_source: source, p_items: items });
      if (error) throw new Error(`set_team_names_en: ${error.message}`);
      return data as number;
    },
    async matchesAwaitingResults(source, limit) {
      const { data, error } = await db.rpc("matches_awaiting_results", { p_source: source, p_limit: limit });
      if (error) throw new Error(`matches_awaiting_results: ${error.message}`);
      return (data as { external_id: string }[]).map((r) => r.external_id);
    },
  };
}

function createCache(db: SupabaseClient, provider: string): ProviderCache {
  return {
    async get<T>(key: string) {
      const { data } = await db
        .from("provider_cache")
        .select("payload")
        .eq("cache_key", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      return (data?.payload as T) ?? null;
    },
    async set(key, value, ttlSeconds) {
      await db.from("provider_cache").upsert({
        cache_key: key,
        provider,
        payload: value,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      });
    },
  };
}

async function createProviders(db: SupabaseClient): Promise<SportsDataProvider[]> {
  const enabled = (Deno.env.get("SPORTS_PROVIDERS") ?? "oddspapi").split(",").map((s) => s.trim());
  const providers: SportsDataProvider[] = [];

  if (enabled.includes("oddspapi")) {
    const apiKey = Deno.env.get("ODDSPAPI_API_KEY");
    if (!apiKey) throw new Error("SPORTS_PROVIDERS содержит oddspapi, но ODDSPAPI_API_KEY не задан");
    const { data, error } = await db.from("leagues").select("code, sport_id, external_ids").eq("is_active", true);
    if (error) throw new Error(`leagues: ${error.message}`);
    // Турнир (external_ids.oddspapi) или вид спорта целиком (external_ids.oddspapi_sport, киберспорт).
    const leagues: OddsPapiLeagueConfig[] = (data as { code: string; sport_id: string; external_ids: Record<string, string> }[])
      .filter((l) => l.external_ids?.oddspapi || l.external_ids?.oddspapi_sport)
      .map(
        (l) =>
          ({
            code: l.code,
            sportId: l.sport_id,
            tournamentId: l.external_ids.oddspapi ? String(l.external_ids.oddspapi) : undefined,
            opSportId: l.external_ids.oddspapi_sport ? String(l.external_ids.oddspapi_sport) : undefined,
            tournamentPattern: l.external_ids.oddspapi_tournaments || undefined,
          }) as OddsPapiLeagueConfig,
      );
    providers.push(
      new OddsPapiProvider({
        apiKey,
        leagues,
        bookmakers: Deno.env.get("ODDSPAPI_BOOKMAKERS")?.split(",").map((s) => s.trim()).filter(Boolean),
        cache: createCache(db, "oddspapi"),
        maxFixturesPerRun: Number(Deno.env.get("ODDSPAPI_MAX_FIXTURES") ?? 4),
        // Бесплатный план — 250 запросов: держим жёсткий бюджет на запуск.
        maxRequestsPerRun: Number(Deno.env.get("ODDSPAPI_MAX_REQUESTS") ?? 10),
      }),
    );
  }
  return providers;
}

/**
 * Провайдеры статистики для матчей, линии которых пришли от других источников.
 * RESULTS_PROVIDERS=nhl,apifootball,opendota (по умолчанию nhl,opendota — бесплатно, без ключа).
 */
async function createResultsProviders(db: SupabaseClient): Promise<ResultsProvider[]> {
  const enabled = (Deno.env.get("RESULTS_PROVIDERS") ?? "nhl,opendota").split(",").map((s) => s.trim()).filter(Boolean);
  const providers: ResultsProvider[] = [];
  if (enabled.includes("nhl")) providers.push(new NhlResultsProvider());
  if (enabled.includes("opendota")) providers.push(new OpenDotaResultsProvider());
  if (enabled.includes("apifootball")) {
    const apiKey = Deno.env.get("APIFOOTBALL_API_KEY");
    if (!apiKey) throw new Error("RESULTS_PROVIDERS содержит apifootball, но APIFOOTBALL_API_KEY не задан");
    const { data, error } = await db.from("leagues").select("code, external_ids").eq("sport_id", "football").eq("is_active", true);
    if (error) throw new Error(`leagues: ${error.message}`);
    const leagues = (data as { code: string; external_ids: Record<string, string> }[])
      .filter((l) => l.external_ids?.apifootball)
      .map((l) => ({ code: l.code, leagueId: String(l.external_ids.apifootball) }) as ApiFootballLeague);
    if (leagues.length > 0) providers.push(new ApiFootballResultsProvider({ apiKey, leagues, cache: createCache(db, "apifootball") }));
  }
  return providers;
}

function createResultsSink(db: SupabaseClient): ExternalResultsSink {
  return {
    async awaiting(leagueCodes, limit, sportIds) {
      const { data, error } = await db.rpc("matches_awaiting_external_results", {
        p_league_codes: leagueCodes,
        p_limit: limit,
        p_sport_ids: sportIds,
      });
      if (error) throw new Error(`matches_awaiting_external_results: ${error.message}`);
      return data as AwaitingMatch[];
    },
    async ingest(matchId, provider, gameId, payload) {
      const { data, error } = await db.rpc("ingest_match_stats", {
        p_match_id: matchId,
        p_provider: provider,
        p_external_game_id: gameId,
        p_payload: payload,
      });
      if (error) throw new Error(`ingest_match_stats: ${error.message}`);
      return data;
    },
  };
}

function createHouseSink(db: SupabaseClient): HouseSink {
  const check = <T,>({ data, error }: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data as T;
  };
  return {
    async knownFixtures(provider, ids) {
      if (ids.length === 0) return new Set();
      const rows = check(
        await db.from("stat_history").select("fixture_external_id").eq("provider", provider).in("fixture_external_id", ids),
        "stat_history",
      ) as { fixture_external_id: string }[];
      return new Set(rows.map((r) => r.fixture_external_id));
    },
    async saveHistory(rows) {
      if (rows.length) check(await db.from("stat_history").upsert(rows, { ignoreDuplicates: true }), "stat_history");
    },
    async savePriors(rows) {
      if (rows.length) check(await db.from("stat_priors").upsert(rows), "stat_priors");
    },
    async loadForms(provider, season, ids) {
      const history = new Map<string, StatLine[]>();
      const priors = new Map<string, { appearances: number; minutes: number; totals: Record<string, number> }>();
      if (ids.length === 0) return { history, priors };
      const h = check(
        await db
          .from("stat_history")
          .select("player_external_id, minutes, stats")
          .eq("provider", provider)
          .in("player_external_id", ids)
          .order("played_at", { ascending: false }),
        "stat_history",
      ) as { player_external_id: string; minutes: number; stats: Record<string, number> }[];
      for (const r of h) history.set(r.player_external_id, [...(history.get(r.player_external_id) ?? []), { minutes: r.minutes, stats: r.stats }]);
      const p = check(
        await db
          .from("stat_priors")
          .select("player_external_id, appearances, minutes, totals")
          .eq("provider", provider)
          .eq("season", season)
          .in("player_external_id", ids),
        "stat_priors",
      ) as { player_external_id: string; appearances: number; minutes: number; totals: Record<string, number> }[];
      for (const r of p) priors.set(r.player_external_id, { appearances: r.appearances, minutes: r.minutes, totals: r.totals });
      return { history, priors };
    },
    getProgress: (key) => createCache(db, "pickup").get(key),
    setProgress: (key, value) => createCache(db, "pickup").set(key, value, 365 * 86_400),
    async ingestSlate(source, payload) {
      return check(await db.rpc("ingest_slate", { p_source: source, p_payload: payload }), "ingest_slate");
    },
  };
}

/** Виды спорта, для которых загружается полное расписание. */
async function scheduleSports(db: SupabaseClient): Promise<{ id: SportId; opSportId: string }[]> {
  const { data, error } = await db
    .from("sports")
    .select("id, oddspapi_sport_id")
    .eq("schedule_enabled", true)
    .not("oddspapi_sport_id", "is", null)
    .order("sort_order");
  if (error) throw new Error(`sports: ${error.message}`);
  return (data as { id: SportId; oddspapi_sport_id: number }[]).map((s) => ({ id: s.id, opSportId: String(s.oddspapi_sport_id) }));
}

function createScheduleSink(db: SupabaseClient): ScheduleSink {
  return {
    async ingestSchedule(source, payload) {
      const { data, error } = await db.rpc("ingest_schedule", { p_source: source, p_payload: payload });
      if (error) throw new Error(`ingest_schedule: ${error.message}`);
      return data;
    },
  };
}

/**
 * Матчи, для которых запрашиваются линии на игроков: лиги с props_enabled и
 * турниры первого эшелона в киберспорте; ближайшие 48 часов.
 */
async function propsCandidates(db: SupabaseClient): Promise<PropsCandidate[]> {
  const now = new Date();
  const base = () =>
    db
      .from("matches")
      .select("external_id, starts_at, league:leagues!inner(code, sport_id, name, props_enabled)")
      .eq("source", "oddspapi")
      .eq("status", "SCHEDULED")
      .gt("starts_at", now.toISOString())
      .lt("starts_at", new Date(now.getTime() + 48 * 3600_000).toISOString())
      .order("starts_at")
      .limit(60);
  const [props, esports] = await Promise.all([
    base().eq("league.props_enabled", true),
    base().in("league.sport_id", ["dota", "cs"]),
  ]);
  if (props.error) throw new Error(`matches: ${props.error.message}`);
  if (esports.error) throw new Error(`matches: ${esports.error.message}`);
  type Row = { external_id: string; starts_at: string; league: { code: string; sport_id: SportId; name: string } };
  const tier1 = new RegExp(TIER1_ESPORTS, "i");
  const rows = [...(props.data as unknown as Row[]), ...(esports.data as unknown as Row[]).filter((r) => tier1.test(r.league.name))];
  const unique = new Map(rows.map((r) => [r.external_id, r]));
  return [...unique.values()].map((r) => ({
    externalId: r.external_id,
    leagueCode: r.league.code,
    sportId: r.league.sport_id,
    startsAt: r.starts_at,
  }));
}

/**
 * Свои линии PICKUP (HOUSE_LINES=RPL): лиги без линий букмекеров на игроков.
 * Данные — API-Football; по Cron не чаще раза в HOUSE_INTERVAL_HOURS часов.
 */
async function runHouseLines(db: SupabaseClient, caller: string, report: Record<string, unknown>) {
  const codes = (Deno.env.get("HOUSE_LINES") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const apiKey = Deno.env.get("APIFOOTBALL_API_KEY");
  if (codes.length === 0 || !apiKey) return;
  // Пока первичная загрузка не завершена (complete=false), Cron продолжает её каждый запуск.
  if (caller === "cron" && (await ranRecently(db, HOUSE_SOURCE, Number(Deno.env.get("HOUSE_INTERVAL_HOURS") ?? 6), "house", true))) {
    report.house = { skipped: 1 };
    return;
  }
  const { data } = await db.from("leagues").select("code, external_ids").in("code", codes);
  for (const league of (data ?? []) as { code: string; external_ids: Record<string, string> }[]) {
    const leagueId = league.external_ids?.apifootball;
    if (!leagueId) continue;
    const af = new ApiFootballResultsProvider({
      apiKey,
      leagues: [{ code: league.code as LeagueCode, leagueId }],
      cache: createCache(db, "apifootball"),
    });
    report[`house:${league.code}`] = await tracked(db, HOUSE_SOURCE, "house", () =>
      syncHouseLines(af, createHouseSink(db), {
        leagueCode: league.code,
        leagueId,
        deadline: Date.now() + Number(Deno.env.get("HOUSE_TIME_BUDGET_SECONDS") ?? 90) * 1000,
      }),
    );
  }
}

async function ranRecently(
  db: SupabaseClient,
  provider: string,
  intervalHours?: number,
  job = "lines",
  onlyComplete = false,
): Promise<boolean> {
  const hours = intervalHours ?? Number(Deno.env.get("ODDSPAPI_MIN_INTERVAL_HOURS") ?? 12);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  let query = db
    .from("sync_runs")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .eq("job", job)
    .eq("status", "SUCCESS")
    .gt("started_at", since);
  if (onlyComplete) query = query.eq("details->>complete", "true");
  const { count } = await query;
  return (count ?? 0) > 0;
}

function createLogosSink(db: SupabaseClient): LogosSink {
  return {
    async teamsNeedingLogos(limit) {
      const { data, error } = await db.rpc("teams_needing_logos", { p_limit: limit });
      if (error) throw new Error(`teams_needing_logos: ${error.message}`);
      return data as LogoCandidate[];
    },
    async setTeamLogos(items) {
      if (items.length === 0) return 0;
      const { data, error } = await db.rpc("set_team_logos", { p_items: items });
      if (error) throw new Error(`set_team_logos: ${error.message}`);
      return data as number;
    },
  };
}

function createPhotosSink(db: SupabaseClient): PhotosSink {
  return {
    async playersNeedingPhotos(limit) {
      const { data, error } = await db.rpc("players_needing_photos", { p_limit: limit });
      if (error) throw new Error(`players_needing_photos: ${error.message}`);
      return data as PhotoCandidate[];
    },
    async setPlayerPhotos(items) {
      if (items.length === 0) return 0;
      const { data, error } = await db.rpc("set_player_photos", { p_items: items });
      if (error) throw new Error(`set_player_photos: ${error.message}`);
      return data as number;
    },
  };
}

/** Выполняет задачу и пишет результат в sync_runs (видно в админке). */
async function tracked<T extends Record<string, unknown>>(
  db: SupabaseClient,
  provider: string,
  job: string,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  const { data: run } = await db.from("sync_runs").insert({ provider, job }).select("id").single();
  try {
    const details = await fn();
    const items = Object.values(details).reduce<number>((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
    await db
      .from("sync_runs")
      .update({ status: "SUCCESS", details, items_processed: items, finished_at: new Date().toISOString() })
      .eq("id", run?.id);
    return details;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("sync_runs")
      .update({ status: "ERROR", error: message, finished_at: new Date().toISOString() })
      .eq("id", run?.id);
    return { error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const caller = await authorize(req, db);
  if (!caller) return json({ error: "Доступ запрещён" }, 403);

  const body = (await req.json().catch(() => ({}))) as { action?: string; match_id?: string };
  const action = body.action ?? "sync";

  try {
    // Логотипы — из бесплатных источников, без бюджета OddsPapi.
    if (action === "logos") {
      const report = await tracked(db, "logos", "logos", () =>
        syncTeamLogos(createLogosSink(db), {
          limit: Number(Deno.env.get("LOGOS_BATCH") ?? 12),
          sportsDbKey: Deno.env.get("THESPORTSDB_API_KEY") ?? "123",
        }),
      );
      return json({ caller, action, report });
    }
    if (action === "photos") {
      const report = await tracked(db, "photos", "photos", () =>
        syncPlayerPhotos(createPhotosSink(db), {
          limit: Number(Deno.env.get("PHOTOS_BATCH") ?? 10),
          // Без ключа Sportmonks футбольный источник пропускается (не имитируется).
          sportmonksKey: Deno.env.get("SPORTMONKS_API_KEY") ?? null,
          // Контакт для User-Agent запросов к Wikimedia (сайт или адрес владельца).
          contact: Deno.env.get("WIKIMEDIA_CONTACT") ?? null,
        }),
      );
      return json({ caller, action, report });
    }

    const providers = await createProviders(db);
    const sink = createSink(db);

    if (action === "status") {
      const resultsProviders = await createResultsProviders(db).catch(() => []);
      return json({
        providers: providers.map((p) => ({ id: p.id, capabilities: p.capabilities })),
        results_providers: resultsProviders.map((p) => ({ id: p.id, leagues: p.leagues })),
        oddspapi_key_configured: Boolean(Deno.env.get("ODDSPAPI_API_KEY")),
        apifootball_key_configured: Boolean(Deno.env.get("APIFOOTBALL_API_KEY")),
      });
    }

    const report: Record<string, unknown> = {};
    for (const provider of providers) {
      if (!(provider instanceof OddsPapiProvider)) continue;
      // Платный источник по Cron обновляется не чаще раза в N часов;
      // ручной запуск из админки выполняется всегда.
      if (action === "sync" || action === "schedule") {
        const hours = Number(Deno.env.get("SCHEDULE_INTERVAL_HOURS") ?? 12);
        if (caller === "cron" && (await ranRecently(db, provider.id, hours, "schedule"))) {
          report[`${provider.id}:schedule`] = { skipped: 1 };
        } else {
          const sports = await scheduleSports(db);
          report[`${provider.id}:schedule`] = await tracked(db, provider.id, "schedule", () =>
            syncSchedule(provider, createScheduleSink(db), sports),
          );
        }
      }
      if (action === "sync" || action === "lines") {
        if (caller === "cron" && (await ranRecently(db, provider.id))) {
          report[`${provider.id}:lines`] = { skipped: 1 };
        } else {
          const candidates = await propsCandidates(db);
          report[`${provider.id}:lines`] = await tracked(db, provider.id, "lines", () =>
            syncPropsForMatches(provider, sink, candidates),
          );
        }
      }
    }
    if (action === "sync" || action === "lines") await runHouseLines(db, caller, report);

    if (action === "sync" || action === "results") {
      const resultsProviders = await createResultsProviders(db);
      if (resultsProviders.length > 0) {
        const limit = Number(Deno.env.get("RESULTS_MAX_MATCHES") ?? 10);
        report.external_results = await tracked(db, resultsProviders.map((p) => p.id).join("+"), "external-results", async () => {
          const r = await syncExternalResults(resultsProviders, createResultsSink(db), { limit });
          // Несопоставленные спортсмены — повод для проверки, видно в журнале.
          if (r.errors.length > 0) throw new Error(`${JSON.stringify({ ...r, errors: undefined })} ${r.errors.join("; ")}`);
          return { ...r, errors: undefined } as unknown as Record<string, number>;
        });
      }
    }
    // Матчи, результаты которых ввёл администратор, тоже рассчитываются.
    const { data: settled } = await db.rpc("service_settle_ready_matches");
    report.settled = settled;
    return json({ caller, action, report });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
