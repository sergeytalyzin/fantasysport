"use client";

import { Loader2, Ticket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { Chip, ChipRow } from "@/components/sports/chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LINEUP_TABS, useMyLineups } from "@/features/picks/hooks";
import { errorMessage } from "@/lib/errors";
import { LineupCard } from "./lineup-card";

type Tab = keyof typeof LINEUP_TABS;

export function MyLineups() {
  const [tab, setTab] = useState<Tab>("active");
  const query = useMyLineups(tab);
  const lineups = query.data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      <ChipRow>
        {(Object.keys(LINEUP_TABS) as Tab[]).map((key) => (
          <Chip key={key} active={tab === key} onClick={() => setTab(key)}>
            {LINEUP_TABS[key].label}
          </Chip>
        ))}
      </ChipRow>

      {query.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-3xl" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : lineups.length === 0 ? (
        <EmptyState icon={<Ticket className="size-10" />} title="Здесь пока пусто">
          {tab === "active" ? (
            <>
              Соберите первый купон на{" "}
              <Link href="/" className="font-semibold text-primary hover:underline">
                странице линий
              </Link>
              .
            </>
          ) : (
            "Купоны появятся здесь после расчёта."
          )}
        </EmptyState>
      ) : (
        <>
          <div className="grid items-start gap-3 md:grid-cols-2">
            {lineups.map((lineup) => (
              <LineupCard key={lineup.id} lineup={lineup} />
            ))}
          </div>
          {query.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null} Показать ещё
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
