"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AppSettings, League, Market, PayoutRule, Sport } from "@/types/domain";

// Справочники меняются редко — кэшируем надолго.
const REFERENCE_STALE = 10 * 60_000;

export function useSports() {
  return useQuery({
    queryKey: queryKeys.sports,
    staleTime: REFERENCE_STALE,
    queryFn: async () =>
      unwrap(await getSupabaseBrowserClient().from("sports").select("id, name, sort_order").eq("is_active", true).order("sort_order")) as Sport[],
  });
}

export function useLeagues() {
  return useQuery({
    queryKey: queryKeys.leagues,
    staleTime: REFERENCE_STALE,
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowserClient()
          .from("leagues")
          .select("id, sport_id, code, name, short_name, sort_order, external_ids, is_active")
          .order("sort_order"),
      ) as League[],
  });
}

export function useMarkets() {
  return useQuery({
    queryKey: queryKeys.markets,
    staleTime: REFERENCE_STALE,
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowserClient()
          .from("markets")
          .select("id, sport_id, code, name, short_name, components, sort_order")
          .eq("is_active", true)
          .order("sort_order"),
      ) as Market[],
  });
}

export function useAppSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    staleTime: REFERENCE_STALE,
    queryFn: async () => {
      const rows = unwrap(await getSupabaseBrowserClient().from("app_settings").select("key, value")) as {
        key: keyof AppSettings;
        value: number | boolean;
      }[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value])) as unknown as AppSettings;
    },
  });
}

export function usePayoutRules() {
  return useQuery({
    queryKey: queryKeys.payoutRules,
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowserClient()
          .from("payout_rules")
          .select("id, play_type, picks_count, correct_count, multiplier, is_active")
          .order("play_type")
          .order("picks_count")
          .order("correct_count", { ascending: false }),
      ) as PayoutRule[],
  });
}
