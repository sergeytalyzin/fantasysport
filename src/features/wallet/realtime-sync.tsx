"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-provider";
import { formatRub } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Lineup } from "@/types/domain";

/**
 * Одна подписка Realtime на пользователя: только его кошелёк и купоны
 * (фильтр + RLS). Рейтинг не транслируется — он обновляется по запросу.
 */
export function RealtimeSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const supabase = getSupabaseBrowserClient();
    const invalidateMoney = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.walletAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.transactionsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileSummaryAll });
    };

    const channel = supabase
      .channel(`user:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` }, invalidateMoney)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "lineups", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const lineup = payload.new as Lineup;
          void queryClient.invalidateQueries({ queryKey: queryKeys.lineupsAll });
          invalidateMoney();
          if (lineup.status === "WON" || lineup.status === "PARTIALLY_WON") {
            toast.success(`Купон сыграл! +${formatRub(lineup.payout ?? 0)}`);
          } else if (lineup.status === "LOST") {
            toast("Купон не сыграл. Следующий будет удачнее!");
          } else if (lineup.status === "VOID" || lineup.status === "REFUNDED") {
            toast.info(`Возврат по купону: ${formatRub(lineup.payout ?? 0)}`);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return null;
}
