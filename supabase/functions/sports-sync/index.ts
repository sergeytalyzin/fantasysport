// Edge Function: синхронизация спортивных данных и симуляция демо-матчей.
//
// POST /functions/v1/sports-sync
//   {"action": "sync"}                       — линии + результаты (Cron, каждые 15 минут)
//   {"action": "lines" | "results"}          — только линии / только результаты
//   {"action": "simulate", "match_id": uuid} — досрочно завершить демо-матч
//   {"action": "status"}                     — состояние провайдеров
//
// Доступ: заголовок x-cron-secret (Cron) или JWT администратора.
// Ключи внешних API хранятся только в Supabase Secrets.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type ApiFootballLeague,
  ApiFootballResultsProvider,
  type AwaitingMatch,
  DemoProvider,
  type ExternalResultsSink,
  NhlResultsProvider,
  type ResultsProvider,
  syncExternalResults,
  type MarketComponents,
  type OddsPapiLeagueConfig,
  OddsPapiProvider,
  type ProviderCache,
  simulateMatch,
  type SportsDataProvider,
  type SyncSink,
  syncLines,
  syncResults,
} from "../_shared/sports-providers/index.ts";

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
  const enabled = (Deno.env.get("SPORTS_PROVIDERS") ?? "demo").split(",").map((s) => s.trim());
  const providers: SportsDataProvider[] = [];

  if (enabled.includes("demo")) {
    const { data, error } = await db.from("markets").select("sport_id, code, components").eq("is_active", true);
    if (error) throw new Error(`markets: ${error.message}`);
    const marketComponents: MarketComponents = {};
    for (const m of data as { sport_id: keyof MarketComponents; code: string; components: string[] }[]) {
      (marketComponents[m.sport_id] ??= {})[m.code] = m.components;
    }
    providers.push(new DemoProvider({ marketComponents }));
  }

  if (enabled.includes("oddspapi")) {
    const apiKey = Deno.env.get("ODDSPAPI_API_KEY");
    if (!apiKey) throw new Error("SPORTS_PROVIDERS содержит oddspapi, но ODDSPAPI_API_KEY не задан");
    const { data, error } = await db.from("leagues").select("code, sport_id, external_ids").eq("is_active", true);
    if (error) throw new Error(`leagues: ${error.message}`);
    const leagues: OddsPapiLeagueConfig[] = (data as { code: string; sport_id: string; external_ids: Record<string, string> }[])
      .filter((l) => l.external_ids?.oddspapi)
      .map((l) => ({ code: l.code, sportId: l.sport_id, tournamentId: String(l.external_ids.oddspapi) }) as OddsPapiLeagueConfig);
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
 * RESULTS_PROVIDERS=nhl,apifootball (по умолчанию nhl — бесплатно, без ключа).
 */
async function createResultsProviders(db: SupabaseClient): Promise<ResultsProvider[]> {
  const enabled = (Deno.env.get("RESULTS_PROVIDERS") ?? "nhl").split(",").map((s) => s.trim()).filter(Boolean);
  const providers: ResultsProvider[] = [];
  if (enabled.includes("nhl")) providers.push(new NhlResultsProvider());
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
    async awaiting(leagueCodes, limit) {
      const { data, error } = await db.rpc("matches_awaiting_external_results", { p_league_codes: leagueCodes, p_limit: limit });
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

async function ranRecently(db: SupabaseClient, provider: string): Promise<boolean> {
  const hours = Number(Deno.env.get("ODDSPAPI_MIN_INTERVAL_HOURS") ?? 12);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { count } = await db
    .from("sync_runs")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .eq("job", "lines")
    .eq("status", "SUCCESS")
    .gt("started_at", since);
  return (count ?? 0) > 0;
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

    if (action === "simulate") {
      if (!body.match_id) return json({ error: "match_id обязателен" }, 400);
      const { data: match, error } = await db
        .from("matches")
        .select("source, external_id")
        .eq("id", body.match_id)
        .single();
      if (error || !match) return json({ error: "Матч не найден" }, 404);
      const provider = providers.find((p) => p.id === match.source);
      if (!provider || provider.id !== "demo") return json({ error: "Симуляция доступна только для демо-матчей" }, 400);
      return json(await tracked(db, provider.id, "simulate", () => simulateMatch(provider, sink, match.external_id)));
    }

    const report: Record<string, unknown> = {};
    for (const provider of providers) {
      // Платные источники по Cron обновляются не чаще раза в N часов;
      // ручной запуск из админки выполняется всегда.
      if (caller === "cron" && provider.id === "oddspapi" && (await ranRecently(db, provider.id))) {
        report[`${provider.id}:lines`] = { skipped: 1 };
        continue;
      }
      if (action === "sync" || action === "lines") {
        report[`${provider.id}:lines`] = await tracked(db, provider.id, "lines", () => syncLines(provider, sink));
      }
      if (action === "sync" || action === "results") {
        report[`${provider.id}:results`] = await tracked(db, provider.id, "results", () => syncResults(provider, sink));
      }
    }
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
