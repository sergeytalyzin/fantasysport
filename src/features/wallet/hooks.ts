"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-provider";
import { unwrap } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Wallet, WalletTransaction } from "@/types/domain";

const PAGE = 30;

export function useWallet() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.wallet(user?.id ?? ""),
    enabled: Boolean(user),
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowserClient()
          .from("wallets")
          .select("user_id, balance, reserved, capital, funded_total, updated_at")
          // RLS пускает администратора ко всем кошелькам — фильтр по себе обязателен.
          .eq("user_id", user!.id)
          .single(),
      ) as Wallet,
  });
}

export function useTransactions() {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: queryKeys.transactions(user?.id ?? ""),
    enabled: Boolean(user),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getSupabaseBrowserClient()
          .from("wallet_transactions")
          .select("id, user_id, type, amount, balance_after, reserved_after, lineup_id, description, created_at")
          .eq("user_id", user!.id)
          .order("id", { ascending: false })
          .range(pageParam, pageParam + PAGE - 1),
      ) as WalletTransaction[],
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
}

export function useBonusGrants() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.bonusGrants(user?.id ?? ""),
    enabled: Boolean(user),
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowserClient()
          .from("monthly_bonus_grants")
          .select("id, year, month, kind, amount, created_at")
          .eq("user_id", user!.id)
          .order("year", { ascending: false })
          .order("month", { ascending: false }),
      ) as { id: number; year: number; month: number; kind: "REGISTRATION" | "MONTHLY"; amount: number; created_at: string }[],
  });
}
