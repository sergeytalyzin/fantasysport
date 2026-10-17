// Edge Function: live-снимок матча для экрана трансляции.
//
// GET /functions/v1/live-match?match_id=<uuid>
//
// Публичная (только чтение), сторонние API вызываются только отсюда. Ответы
// кэшируются в provider_cache: сколько бы зрителей ни смотрело матч, к
// провайдеру уходит не больше одного запроса за TTL.
//   НХЛ — play-by-play каждые 15 с; футбол — раз в 3 мин (лимит API-Football);
//   демо — вычисляется на лету без внешних запросов.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type AfFixtureLive, apiFootballSnapshot } from "../_shared/live/apifootball-live.ts";
import { demoSnapshot } from "../_shared/live/demo-live.ts";
import { type NhlPlayByPlay, nhlSnapshot } from "../_shared/live/nhl-live.ts";
import type { LiveSnapshot } from "../_shared/live/types.ts";
import {
  ApiFootballResultsProvider,
  type AwaitingMatch,
  DemoProvider,
  NhlResultsProvider,
} from "../_shared/sports-providers/index.ts";
import { pickGame } from "../_shared/sports-providers/results/sync-results.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOOTBALL = new Set(["RPL", "EPL", "UCL"]);

interface MatchRow {
  id: string;
  starts_at: string;
  source: string;
  external_id: string;
  league: { code: string; sport_id: string; external_ids: Record<string, string> };
  home: { name: string; short_name: string; abbr: string };
  away: { name: string; short_name: string; abbr: string };
}

async function cacheGet<T>(db: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await db
    .from("provider_cache")
    .select("payload")
    .eq("cache_key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return (data?.payload as T) ?? null;
}

async function cacheSet(db: SupabaseClient, key: string, provider: string, payload: unknown, ttlSeconds: number) {
  await db.from("provider_cache").upsert({
    cache_key: key,
    provider,
    payload,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}

/** Если хозяева у источников разные — меняем стороны и отражаем координаты. */
function swapSides(s: LiveSnapshot): LiveSnapshot {
  return {
    ...s,
    home: s.away,
    away: s.home,
    events: s.events.map((e) => ({
      ...e,
      side: e.side === "home" ? "away" : "home",
      x: e.x == null ? e.x : s.surface === "pitch" ? 105 - e.x : -e.x,
      y: e.y == null ? e.y : s.surface === "pitch" ? 68 - e.y : -e.y,
    })),
    leaders: s.leaders.map((l) => ({ ...l, side: l.side === "home" ? "away" : "home" })),
  };
}

const asAwaiting = (m: MatchRow): AwaitingMatch => ({
  match_id: m.id,
  league_code: m.league.code as AwaitingMatch["league_code"],
  starts_at: m.starts_at,
  home: m.home,
  away: m.away,
  players: [],
  link: null,
});

/** Игра провайдера для матча: ищется один раз и запоминается на 12 часов. */
async function linkGame(
  db: SupabaseClient,
  m: MatchRow,
  provider: NhlResultsProvider | ApiFootballResultsProvider,
): Promise<{ gameId: string; swapped: boolean } | null> {
  const key = `live:game:${provider.id}:${m.id}`;
  const cached = await cacheGet<{ gameId: string; swapped: boolean }>(db, key);
  if (cached) return cached;
  const picked = pickGame(asAwaiting(m), await provider.findGames(asAwaiting(m)));
  if (!picked) return null;
  const link = { gameId: picked.game.gameId, swapped: picked.swapped };
  await cacheSet(db, key, provider.id, link, 12 * 3600);
  return link;
}

async function liveSnapshot(db: SupabaseClient, m: MatchRow): Promise<{ snapshot: LiveSnapshot | null; ttl: number; reason?: string }> {
  if (m.source === "demo") {
    return { snapshot: await demoSnapshot(new DemoProvider({ marketComponents: {} }), m.external_id), ttl: 0 };
  }

  if (m.league.code === "NHL") {
    const nhl = new NhlResultsProvider();
    const link = await linkGame(db, m, nhl);
    if (!link) return { snapshot: null, ttl: 300, reason: "game_not_found" };
    const snap = nhlSnapshot(await nhl.getPlayByPlay<NhlPlayByPlay>(link.gameId));
    return { snapshot: link.swapped ? swapSides(snap) : snap, ttl: snap.state === "FINAL" ? 3600 : 15 };
  }

  const apiKey = Deno.env.get("APIFOOTBALL_API_KEY");
  const leagueId = m.league.external_ids?.apifootball;
  if (FOOTBALL.has(m.league.code) && apiKey && leagueId) {
    const af = new ApiFootballResultsProvider({
      apiKey,
      leagues: [{ code: m.league.code as AwaitingMatch["league_code"], leagueId }],
      minIntervalMs: 0,
      cache: {
        get: (key) => cacheGet(db, key),
        set: (key, value, ttl) => cacheSet(db, key, "apifootball", value, ttl),
      },
    });
    const link = await linkGame(db, m, af);
    if (!link) return { snapshot: null, ttl: 600, reason: "game_not_found" };
    const fixture = await af.getFixtureLive<AfFixtureLive>(link.gameId);
    if (!fixture) return { snapshot: null, ttl: 600, reason: "game_not_found" };
    const snap = apiFootballSnapshot(fixture);
    const ttl = snap.state === "FINAL" ? 3600 : snap.state === "PRE" ? 600 : 180;
    return { snapshot: link.swapped ? swapSides(snap) : snap, ttl };
  }

  return { snapshot: null, ttl: 3600, reason: "unsupported" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as { match_id?: string }) : {};
  const matchId = url.searchParams.get("match_id") ?? body.match_id ?? "";
  if (!UUID.test(matchId)) return json({ error: "match_id обязателен" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const cacheKey = `live:snapshot:${matchId}`;
  const cached = await cacheGet<{ snapshot: LiveSnapshot | null; reason?: string }>(db, cacheKey);
  if (cached) return json(cached);

  const { data: match, error } = await db
    .from("matches")
    .select(
      `id, starts_at, source, external_id,
       league:leagues!inner(code, sport_id, external_ids),
       home:teams!matches_home_team_id_fkey(name, short_name, abbr),
       away:teams!matches_away_team_id_fkey(name, short_name, abbr)`,
    )
    .eq("id", matchId)
    .maybeSingle();
  if (error || !match) return json({ error: "Матч не найден" }, 404);

  try {
    const { snapshot, ttl, reason } = await liveSnapshot(db, match as unknown as MatchRow);
    const payload = { snapshot, reason };
    if (ttl > 0) await cacheSet(db, cacheKey, snapshot?.provider ?? "live", payload, ttl);
    return json(payload);
  } catch (e) {
    return json({ snapshot: null, reason: "provider_error", error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
