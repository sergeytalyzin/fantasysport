"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-provider";
import { unwrap } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Lineup, LineupStatus, PlayType } from "@/types/domain";
import { type CouponPick, toRpcSelections } from "./coupon-logic";

export const LINEUP_TABS: Record<string, { label: string; statuses: LineupStatus[] }> = {
  active: { label: "Активные", statuses: ["PENDING"] },
  won: { label: "Выигранные", statuses: ["WON"] },
  lost: { label: "Проигранные", statuses: ["LOST"] },
  partial: { label: "Частично", statuses: ["PARTIALLY_WON"] },
  refunded: { label: "Возвраты", statuses: ["VOID", "REFUNDED"] },
};

const PAGE = 15;

export function useMyLineups(tab: keyof typeof LINEUP_TABS) {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: queryKeys.lineups(user?.id ?? "", tab),
    enabled: Boolean(user),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const rows = unwrap(
        await getSupabaseBrowserClient()
          .from("lineups")
          .select(
            `id, user_id, play_type, picks_count, stake, multiplier, potential_payout, status,
             applied_multiplier, payout, settled_at, settlement_note, created_at,
             selections:lineup_selections(id, projection_id, player_id, direction, line, player_name, team_abbr,
               opponent_abbr, market_name, league_code, match_starts_at, result, actual_value, result_reason)`,
          )
          .eq("user_id", user!.id)
          .in("status", LINEUP_TABS[tab].statuses)
          .order("created_at", { ascending: false })
          .range(pageParam, pageParam + PAGE - 1),
      ) as Lineup[];
      return rows.map((l) => ({
        ...l,
        multiplier: Number(l.multiplier),
        applied_multiplier: l.applied_multiplier === null ? null : Number(l.applied_multiplier),
        selections: [...l.selections]
          .map((s) => ({ ...s, line: Number(s.line), actual_value: s.actual_value === null ? null : Number(s.actual_value) }))
          .sort((a, b) => a.match_starts_at.localeCompare(b.match_starts_at)),
      }));
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
}

export interface CreateLineupInput {
  playType: PlayType;
  stakeRub: number;
  picks: CouponPick[];
  expectedMultiplier: number;
  idempotencyKey: string;
}

export function useCreateLineup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLineupInput) =>
      unwrap(
        await getSupabaseBrowserClient()
          .rpc("create_lineup", {
            p_play_type: input.playType,
            p_stake: input.stakeRub * 100,
            p_selections: toRpcSelections(input.picks),
            p_expected_multiplier: input.expectedMultiplier,
            p_idempotency_key: input.idempotencyKey,
          })
          .single(),
      ) as Omit<Lineup, "selections">,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.walletAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lineupsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileSummaryAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.transactionsAll });
    },
  });
}
