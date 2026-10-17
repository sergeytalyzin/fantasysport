"use client";

import { useQuery } from "@tanstack/react-query";
import type { LiveSnapshot } from "@shared/live/types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

export type { LiveEvent, LiveSnapshot } from "@shared/live/types";

export interface LiveResponse {
  snapshot: LiveSnapshot | null;
  reason?: "unsupported" | "game_not_found" | "provider_error";
}

/**
 * Live-снимок матча из Edge Function live-match. Сервер кэширует ответы
 * провайдеров, поэтому частый опрос не расходует лимиты внешних API.
 */
export function useLiveMatch(matchId: string, enabled = true) {
  return useQuery({
    queryKey: ["live", matchId],
    enabled,
    queryFn: async (): Promise<LiveResponse> => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/live-match?match_id=${matchId}`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
      });
      if (!res.ok) throw new Error(`live-match: HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: (query) => {
      const snapshot = query.state.data?.snapshot;
      if (!snapshot || snapshot.state === "FINAL") return false;
      // Футбол обновляется на сервере раз в 3 минуты — чаще спрашивать незачем.
      return snapshot.provider === "apifootball" ? 60_000 : 15_000;
    },
    refetchIntervalInBackground: false,
  });
}
