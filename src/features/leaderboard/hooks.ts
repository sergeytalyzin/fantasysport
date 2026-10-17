"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-provider";
import { unwrap } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LeaderboardPeriod, MonthlyLeaderboardRow, MyRank, OverallLeaderboardRow } from "@/types/domain";

// Контролируемое обновление: рейтинг перезапрашивается раз в минуту, без Realtime.
const REFRESH = 60_000;

/** top10/top100 — фиксированный размер; all — страницы по 50 с догрузкой. */
export type LeaderboardScope = "top10" | "top100" | "all";
const PAGE_SIZE: Record<LeaderboardScope, number> = { top10: 10, top100: 100, all: 50 };

function paging(scope: LeaderboardScope) {
  const size = PAGE_SIZE[scope];
  return {
    initialPageParam: 0,
    getNextPageParam: (last: unknown[], all: unknown[][]) =>
      scope === "all" && last.length === size ? all.length * size : undefined,
    size,
  };
}

export function useOverallLeaderboard(search: string, scope: LeaderboardScope) {
  const { size, ...pages } = paging(scope);
  return useInfiniteQuery({
    queryKey: queryKeys.leaderboardOverall(search, size),
    refetchInterval: REFRESH,
    placeholderData: keepPreviousData,
    ...pages,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getSupabaseBrowserClient().rpc("get_overall_leaderboard", {
          p_search: search || null,
          p_limit: size,
          p_offset: pageParam,
        }),
      ) as OverallLeaderboardRow[],
  });
}

export function useMonthlyLeaderboard(year: number, month: number, search: string, scope: LeaderboardScope) {
  const { size, ...pages } = paging(scope);
  return useInfiniteQuery({
    queryKey: queryKeys.leaderboardMonthly(year, month, search, size),
    refetchInterval: REFRESH,
    placeholderData: keepPreviousData,
    ...pages,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await getSupabaseBrowserClient().rpc("get_monthly_leaderboard", {
          p_year: year,
          p_month: month,
          p_search: search || null,
          p_limit: size,
          p_offset: pageParam,
        }),
      ) as MonthlyLeaderboardRow[],
  });
}

export function useLeaderboardPeriods() {
  return useQuery({
    queryKey: queryKeys.leaderboardPeriods,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      unwrap(await getSupabaseBrowserClient().rpc("get_leaderboard_periods")) as LeaderboardPeriod[],
  });
}

export function useMyOverallRank() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.myRank("overall", user?.id ?? ""),
    enabled: Boolean(user),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const rows = unwrap(await getSupabaseBrowserClient().rpc("get_my_overall_rank")) as MyRank[];
      return rows[0] ?? null;
    },
  });
}

export function useMyMonthlyRank(year: number, month: number) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.myRank("monthly", user?.id ?? "", year, month),
    enabled: Boolean(user),
    refetchInterval: REFRESH,
    queryFn: async () => {
      const rows = unwrap(
        await getSupabaseBrowserClient().rpc("get_my_monthly_rank", { p_year: year, p_month: month }),
      ) as MyRank[];
      return rows[0] ?? null;
    },
  });
}
