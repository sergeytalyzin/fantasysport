"use client";

import { useState } from "react";
import { LineupStatusBadge } from "@/components/lineups/lineup-status";
import { Chip, ChipRow } from "@/components/sports/chip";
import { Button } from "@/components/ui/button";
import { refundLineup, useAdminLineups, useAdminMutation } from "@/features/admin/hooks";
import { formatDateTime, formatMultiplier, formatRub } from "@/lib/format";
import type { LineupStatus } from "@/types/domain";
import { AdminPanel, ListSkeleton } from "./admin-ui";

const FILTERS: { value: LineupStatus | null; label: string }[] = [
  { value: null, label: "Все" },
  { value: "PENDING", label: "Активные" },
  { value: "WON", label: "Выигранные" },
  { value: "PARTIALLY_WON", label: "Частично" },
  { value: "LOST", label: "Проигранные" },
  { value: "VOID", label: "Аннулированные" },
  { value: "REFUNDED", label: "Возвраты" },
];

export function AdminLineups() {
  const [status, setStatus] = useState<LineupStatus | null>("PENDING");
  const { data = [], isLoading } = useAdminLineups(status);
  const refund = useAdminMutation(refundLineup, "Сумма возвращена игроку", [["admin"]]);

  return (
    <>
      <h1 className="text-2xl font-extrabold">Прогнозы</h1>
      <ChipRow className="mx-0 px-0">
        {FILTERS.map((f) => (
          <Chip key={f.label} active={status === f.value} onClick={() => setStatus(f.value)} className="h-8 text-xs">
            {f.label}
          </Chip>
        ))}
      </ChipRow>
      <AdminPanel title={`Купонов: ${data.length}`}>
        {isLoading ? (
          <ListSkeleton />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {l.profile.nickname} · {l.play_type === "POWER" ? "Power" : "Flex"} {l.picks_count}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(l.created_at)} · {l.settlement_note ?? l.id}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="numeric text-sm font-bold">
                    {formatRub(l.stake)} {formatMultiplier(Number(l.multiplier))}
                  </p>
                  {l.payout !== null ? <p className="text-muted-foreground">выплата {formatRub(l.payout)}</p> : null}
                </div>
                <LineupStatusBadge status={l.status} />
                {l.status === "PENDING" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={refund.isPending}
                    onClick={() => {
                      const reason = window.prompt("Причина возврата");
                      if (reason) refund.mutate({ lineupId: l.id, reason });
                    }}
                  >
                    Вернуть
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
    </>
  );
}
