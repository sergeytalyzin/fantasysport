"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CouponPick } from "./coupon-logic";

export type PickFreshness = { state: "ok" } | { state: "changed"; line: number } | { state: "closed" };

/**
 * Проверяет выбранные линии точечным запросом (только id из купона), чтобы
 * предупредить об изменении линии или закрытии приёма до отправки купона.
 */
export function useCouponFreshness(picks: CouponPick[]) {
  const ids = picks.map((p) => p.projectionId).sort();
  return useQuery({
    queryKey: ["coupon-freshness", ids],
    enabled: ids.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const rows = unwrap(
        await getSupabaseBrowserClient()
          .from("projections")
          .select("id, line, status, match:matches!inner(status, starts_at)")
          .in("id", ids),
      ) as unknown as { id: string; line: number; status: string; match: { status: string; starts_at: string } }[];
      const now = Date.now();
      const result: Record<string, PickFreshness> = {};
      for (const pick of picks) {
        const row = rows.find((r) => r.id === pick.projectionId);
        if (!row || row.status !== "OPEN" || row.match.status !== "SCHEDULED" || new Date(row.match.starts_at).getTime() <= now) {
          result[pick.projectionId] = { state: "closed" };
        } else if (Number(row.line) !== pick.line) {
          result[pick.projectionId] = { state: "changed", line: Number(row.line) };
        } else {
          result[pick.projectionId] = { state: "ok" };
        }
      }
      return result;
    },
  });
}
