"use client";

import { CalendarX2 } from "lucide-react";
import { useMemo } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { type MatchListItem, topMatches, useLiveMatches, useMatches } from "@/features/matches/hooks";
import { errorMessage } from "@/lib/errors";
import { formatMatchDay, mskDayKey } from "@/lib/format";
import { LiveMatchCard } from "./live-match-card";
import { MatchRow, TopMatchCard } from "./match-cards";

/** Главные события и все матчи по дням (МСК). */
export function MatchesView({ sport, league }: { sport: string | null; league: string | null }) {
  const { data, isLoading, isError, error } = useMatches({ sport, league });
  const { data: live = [] } = useLiveMatches({ sport, league });

  const days = useMemo(() => {
    const groups = new Map<string, MatchListItem[]>();
    for (const m of data ?? []) {
      const key = mskDayKey(m.starts_at);
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return [...groups.values()];
  }, [data]);

  if (isError) return <p className="text-sm text-destructive">Не удалось загрузить матчи: {errorMessage(error)}</p>;
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-56 w-[17.5rem] shrink-0 rounded-3xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState icon={<CalendarX2 className="size-10" />} title="Матчей с линиями пока нет">
        Новые события появляются при синхронизации. Попробуйте другой вид спорта или лигу.
      </EmptyState>
    );
  }

  const top = topMatches(data);
  return (
    <div className="space-y-7">
      {live.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-under opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-under" />
            </span>
            Сейчас идут
          </h2>
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {live.map((m) => (
              <LiveMatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-extrabold">Главные события</h2>
        <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
          {top.map((m) => (
            <TopMatchCard key={m.id} match={m} />
          ))}
        </div>
      </section>

      {days.map((matches) => (
        <section key={matches[0].id} className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground first-letter:uppercase">
            {formatMatchDay(matches[0].starts_at)}
            <span className="ml-2 font-semibold normal-case tracking-normal">· {matches.length}</span>
          </h2>
          <div className="divide-y divide-white/[0.05] overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
            {matches.map((m) => (
              <MatchRow key={m.id} match={m} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
