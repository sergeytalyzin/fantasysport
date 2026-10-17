"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, unwrap } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LineupStatus, MatchStatus, ProjectionStatus, UserRole, WalletTxType } from "@/types/domain";

// Все изменения выполняются через admin_* RPC: права проверяются в БД,
// изменения журналируются в admin_audit_logs.

const db = () => getSupabaseBrowserClient();

export function useAdminMutation<TVars>(fn: (vars: TVars) => Promise<unknown>, success: string, invalidate: string[][]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(success);
      invalidate.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return unwrap(await db().rpc(name, args)) as T;
}

// --- Обзор -----------------------------------------------------------------
export interface AdminDashboard {
  users_total: number;
  users_today: number;
  capital_total: number;
  reserved_total: number;
  lineups_pending: number;
  lineups_today: number;
  projections_open: number;
  matches_awaiting_results: number;
  sync_errors_24h: number;
  last_sync_at: string | null;
}

export function useAdminDashboard() {
  return useQuery({ queryKey: ["admin", "dashboard"], queryFn: () => rpc<AdminDashboard>("admin_dashboard"), refetchInterval: 30_000 });
}

// --- Пользователи и кошельки ----------------------------------------------
export interface AdminUser {
  user_id: string;
  email: string;
  nickname: string;
  role: UserRole;
  created_at: string;
  balance: number;
  reserved: number;
  capital: number;
  funded_total: number;
  lineups_total: number;
}

export function useAdminUsers(search: string) {
  return useQuery({
    queryKey: ["admin", "users", search],
    placeholderData: keepPreviousData,
    queryFn: () => rpc<AdminUser[]>("admin_list_users", { p_search: search || null, p_limit: 100, p_offset: 0 }),
  });
}

export const adjustBalance = (v: { userId: string; amountKopecks: number; reason: string }) =>
  rpc("admin_adjust_balance", { p_user_id: v.userId, p_amount: v.amountKopecks, p_reason: v.reason });

export const setUserRole = (v: { userId: string; role: UserRole }) =>
  rpc("admin_set_user_role", { p_user_id: v.userId, p_role: v.role });

// --- Операции ----------------------------------------------------------------
export interface AdminTransaction {
  id: number;
  user_id: string;
  type: WalletTxType;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
  created_by: string | null;
  wallet: { profile: { nickname: string } };
}

export function useAdminTransactions(type: WalletTxType | null) {
  return useQuery({
    queryKey: ["admin", "transactions", type],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = db()
        .from("wallet_transactions")
        .select("id, user_id, type, amount, balance_after, description, created_at, created_by, wallet:wallets!inner(profile:profiles!inner(nickname))")
        .order("id", { ascending: false })
        .limit(200);
      if (type) q = q.eq("type", type);
      return unwrap(await q) as unknown as AdminTransaction[];
    },
  });
}

// --- Матчи, линии, статистика ---------------------------------------------
export interface AdminMatch {
  id: string;
  starts_at: string;
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  results_confirmed_at: string | null;
  settled_at: string | null;
  source: string;
  external_id: string;
  league: { code: string; short_name: string; sport_id: string };
  home: { id: string; name: string; abbr: string };
  away: { id: string; name: string; abbr: string };
  projections: { count: number }[];
  result_link: {
    provider: string;
    external_game_id: string;
    matched_players: number;
    unmatched_players: string[];
    last_checked_at: string;
  } | null;
}

export type MatchFilter = "upcoming" | "awaiting" | "finished" | "all";

export function useAdminMatches(filter: MatchFilter) {
  return useQuery({
    queryKey: ["admin", "matches", filter],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = db()
        .from("matches")
        .select(
          `id, starts_at, status, home_score, away_score, results_confirmed_at, settled_at, source, external_id,
           league:leagues!inner(code, short_name, sport_id),
           home:teams!matches_home_team_id_fkey(id, name, abbr),
           away:teams!matches_away_team_id_fkey(id, name, abbr),
           projections(count),
           result_link:match_result_links(provider, external_game_id, matched_players, unmatched_players, last_checked_at)`,
        )
        .limit(150);
      const now = new Date().toISOString();
      if (filter === "upcoming") q = q.eq("status", "SCHEDULED").gt("starts_at", now).order("starts_at");
      else if (filter === "awaiting")
        q = q.is("results_confirmed_at", null).in("status", ["SCHEDULED", "LIVE", "FINISHED"]).lt("starts_at", now).order("starts_at");
      else if (filter === "finished") q = q.in("status", ["FINISHED", "CANCELLED"]).order("starts_at", { ascending: false });
      else q = q.order("starts_at", { ascending: false });
      return unwrap(await q) as unknown as AdminMatch[];
    },
  });
}

export interface AdminProjection {
  id: string;
  line: number;
  status: ProjectionStatus;
  source: string;
  line_updated_at: string;
  player: { id: string; full_name: string; team_id: string | null };
  market: { id: string; code: string; name: string; components: string[] };
}

export function useMatchProjections(matchId: string | null) {
  return useQuery({
    queryKey: ["admin", "projections", matchId],
    enabled: Boolean(matchId),
    queryFn: async () =>
      (
        unwrap(
          await db()
            .from("projections")
            .select("id, line, status, source, line_updated_at, player:players!inner(id, full_name, team_id), market:markets!inner(id, code, name, components)")
            .eq("match_id", matchId!)
            .order("created_at"),
        ) as unknown as AdminProjection[]
      ).map((p) => ({ ...p, line: Number(p.line) })),
  });
}

export function useMatchPlayers(match: AdminMatch | null) {
  return useQuery({
    queryKey: ["admin", "match-players", match?.id],
    enabled: Boolean(match),
    queryFn: async () => {
      const [players, stats] = await Promise.all([
        db().from("players").select("id, full_name, position, team_id").in("team_id", [match!.home.id, match!.away.id]).order("full_name"),
        db().from("player_statistics").select("player_id, stats, did_play").eq("match_id", match!.id),
      ]);
      return {
        players: unwrap(players) as { id: string; full_name: string; position: string | null; team_id: string }[],
        stats: unwrap(stats) as { player_id: string; stats: Record<string, number>; did_play: boolean }[],
      };
    },
  });
}

export const setMatchStatus = (v: { matchId: string; status: MatchStatus; home?: number | null; away?: number | null }) =>
  rpc("admin_set_match_status", { p_match_id: v.matchId, p_status: v.status, p_home_score: v.home ?? null, p_away_score: v.away ?? null });

export const upsertPlayerStats = (v: { matchId: string; playerId: string; stats: Record<string, number>; didPlay: boolean }) =>
  rpc("admin_upsert_player_stats", { p_match_id: v.matchId, p_player_id: v.playerId, p_stats: v.stats, p_did_play: v.didPlay });

export const confirmMatchResults = (matchId: string) => rpc<number>("admin_confirm_match_results", { p_match_id: matchId });

export const updateProjection = (v: { id: string; line: number; status: ProjectionStatus }) =>
  rpc("admin_update_projection", { p_projection_id: v.id, p_line: v.line, p_status: v.status });

export const createProjection = (v: { matchId: string; playerId: string; marketId: string; line: number }) =>
  rpc("admin_create_projection", { p_match_id: v.matchId, p_player_id: v.playerId, p_market_id: v.marketId, p_line: v.line });

/** Вызов Edge Function: JWT администратора передаётся автоматически. */
export async function invokeSportsSync(body: { action: string; match_id?: string }) {
  const { data, error } = await db().functions.invoke("sports-sync", { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const details = context ? await context.json().catch(() => null) : null;
    throw new Error(details?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// --- Купоны -------------------------------------------------------------------
export interface AdminLineup {
  id: string;
  user_id: string;
  play_type: string;
  picks_count: number;
  stake: number;
  multiplier: number;
  status: LineupStatus;
  payout: number | null;
  created_at: string;
  settlement_note: string | null;
  profile: { nickname: string };
}

export function useAdminLineups(status: LineupStatus | null) {
  return useQuery({
    queryKey: ["admin", "lineups", status],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = db()
        .from("lineups")
        .select("id, user_id, play_type, picks_count, stake, multiplier, status, payout, created_at, settlement_note, profile:profiles!inner(nickname)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (status) q = q.eq("status", status);
      return unwrap(await q) as unknown as AdminLineup[];
    },
  });
}

export const refundLineup = (v: { lineupId: string; reason: string }) =>
  rpc("admin_refund_lineup", { p_lineup_id: v.lineupId, p_reason: v.reason });

// --- Множители, настройки, система ------------------------------------------
export const upsertPayoutRule = (v: { playType: string; picks: number; correct: number; multiplier: number; isActive: boolean }) =>
  rpc("admin_upsert_payout_rule", {
    p_play_type: v.playType,
    p_picks_count: v.picks,
    p_correct_count: v.correct,
    p_multiplier: v.multiplier,
    p_is_active: v.isActive,
  });

export function useAdminSettings() {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () =>
      unwrap(await db().from("app_settings").select("key, value, description, updated_at").order("key")) as {
        key: string;
        value: number | boolean;
        description: string | null;
        updated_at: string;
      }[],
  });
}

export const updateSetting = (v: { key: string; value: number | boolean }) =>
  rpc("admin_update_setting", { p_key: v.key, p_value: v.value });

export const runMonthlyBonuses = () => rpc<number>("admin_run_monthly_bonuses");
export const settleReadyMatches = () => rpc<number>("admin_settle_ready_matches");

export function useSyncRuns(onlyErrors: boolean) {
  return useQuery({
    queryKey: ["admin", "sync-runs", onlyErrors],
    refetchInterval: 15_000,
    queryFn: async () => {
      let q = db()
        .from("sync_runs")
        .select("id, provider, job, status, items_processed, error, details, started_at, finished_at")
        .order("started_at", { ascending: false })
        .limit(100);
      if (onlyErrors) q = q.eq("status", "ERROR");
      return unwrap(await q) as {
        id: number;
        provider: string;
        job: string;
        status: "RUNNING" | "SUCCESS" | "ERROR";
        items_processed: number;
        error: string | null;
        details: Record<string, unknown>;
        started_at: string;
        finished_at: string | null;
      }[];
    },
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: ["admin", "audit"],
    queryFn: async () =>
      unwrap(
        await db()
          .from("admin_audit_logs")
          .select("id, admin_id, action, target_type, target_id, payload, created_at, admin:profiles(nickname)")
          .order("id", { ascending: false })
          .limit(200),
      ) as unknown as {
        id: number;
        action: string;
        target_type: string;
        target_id: string | null;
        payload: Record<string, unknown>;
        created_at: string;
        admin: { nickname: string } | null;
      }[],
  });
}
