"use client";

import { ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { DemoBadge } from "@/components/layout/demo-badge";
import { Chip, ChipRow } from "@/components/sports/chip";
import { Button } from "@/components/ui/button";
import { type AdminMatch, invokeSportsSync, type MatchFilter, useAdminMatches, useAdminMutation } from "@/features/admin/hooks";
import { formatDateTime } from "@/lib/format";
import type { MatchStatus } from "@/types/domain";
import { AdminMatchDetail } from "./admin-match-detail";
import { AdminPanel, ListSkeleton, StatusPill } from "./admin-ui";

const FILTERS: { value: MatchFilter; label: string }[] = [
  { value: "upcoming", label: "Предстоящие" },
  { value: "awaiting", label: "Ждут результатов" },
  { value: "finished", label: "Завершённые" },
  { value: "all", label: "Все" },
];

export const MATCH_STATUS: Record<MatchStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" | "brand" }> = {
  SCHEDULED: { label: "Запланирован", tone: "brand" },
  LIVE: { label: "Идёт", tone: "warn" },
  FINISHED: { label: "Завершён", tone: "ok" },
  CANCELLED: { label: "Отменён", tone: "bad" },
  POSTPONED: { label: "Перенесён", tone: "muted" },
};

export function AdminMatches() {
  const [filter, setFilter] = useState<MatchFilter>("upcoming");
  const { data = [], isLoading } = useAdminMatches(filter);
  const [picked, setPicked] = useState<AdminMatch | null>(null);
  // После действий список перезапрашивается — берём свежую версию матча, если она есть.
  const selected = picked ? (data.find((m) => m.id === picked.id) ?? picked) : null;
  const sync = useAdminMutation(() => invokeSportsSync({ action: "sync" }), "Синхронизация выполнена", [["admin"], ["board"]]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">События и линии</h1>
        <Button variant="outline" onClick={() => sync.mutate(undefined)} disabled={sync.isPending}>
          <RefreshCw className={sync.isPending ? "animate-spin" : undefined} /> Синхронизировать
        </Button>
      </div>
      <ChipRow className="mx-0 px-0">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)} className="h-8 text-xs">
            {f.label}
          </Chip>
        ))}
      </ChipRow>
      <AdminPanel title={`Матчей: ${data.length}`}>
        {isLoading ? (
          <ListSkeleton />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setPicked(m)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <span className="w-12 shrink-0 text-xs font-bold text-muted-foreground">{m.league.short_name}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {m.home.name} — {m.away.name}
                      {m.home_score !== null ? (
                        <span className="numeric ml-2 text-primary">
                          {m.home_score}:{m.away_score}
                        </span>
                      ) : null}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {formatDateTime(m.starts_at)} · линий: {m.projections[0]?.count ?? 0}
                      {m.source === "demo" ? <DemoBadge /> : <StatusPill tone="muted">{m.source}</StatusPill>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusPill tone={MATCH_STATUS[m.status].tone}>{MATCH_STATUS[m.status].label}</StatusPill>
                    {m.results_confirmed_at ? <StatusPill tone="ok">Подтверждён</StatusPill> : null}
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
      <AdminMatchDetail match={selected} onClose={() => setPicked(null)} />
    </>
  );
}
