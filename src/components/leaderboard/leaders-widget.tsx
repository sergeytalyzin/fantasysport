"use client";

import { ArrowRight, Crown, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { UserAvatar } from "@/components/layout/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/auth-provider";
import { useMonthlyLeaderboard, useMyMonthlyRank, useMyOverallRank, useOverallLeaderboard } from "@/features/leaderboard/hooks";
import { currentMskPeriod, formatRub, formatRubCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

type Kind = "overall" | "monthly";

interface Leader {
  user_id: string;
  rank: number;
  nickname: string;
  avatar_url: string | null;
  value: string;
  positive: boolean | null;
}

// Пьедестал: второе место слева, первое по центру и выше, третье справа.
const PODIUM = [
  { index: 1, ring: "ring-silver", text: "text-silver", step: "h-14 from-silver/25", size: "size-12" },
  { index: 0, ring: "ring-gold", text: "text-gold", step: "h-20 from-gold/30", size: "size-16" },
  { index: 2, ring: "ring-bronze", text: "text-bronze", step: "h-10 from-bronze/25", size: "size-12" },
];

function useLeaders(kind: Kind): { leaders: Leader[]; isLoading: boolean } {
  const { year, month } = currentMskPeriod();
  const overall = useOverallLeaderboard("", "top10");
  const monthly = useMonthlyLeaderboard(year, month, "", "top10");
  if (kind === "overall") {
    return {
      isLoading: overall.isLoading,
      leaders: (overall.data?.pages.flat() ?? []).map((r) => ({ ...r, value: formatRubCompact(r.capital), positive: null })),
    };
  }
  return {
    isLoading: monthly.isLoading,
    leaders: (monthly.data?.pages.flat() ?? []).map((r) => ({
      ...r,
      value: formatRub(r.profit, { sign: true }),
      positive: r.profit > 0 ? true : r.profit < 0 ? false : null,
    })),
  };
}

function MyRank({ kind }: { kind: Kind }) {
  const { year, month } = currentMskPeriod();
  const overall = useMyOverallRank();
  const monthly = useMyMonthlyRank(year, month);
  const data = kind === "overall" ? overall.data : monthly.data;
  if (!data) return null;
  return (
    <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2.5">
      <p className="text-xs font-semibold text-muted-foreground">
        Ваше место <span className="numeric ml-1 text-lg font-extrabold text-primary">{data.rank}</span>
        <span className="text-muted-foreground"> из {data.total_players}</span>
      </p>
      <p className="numeric text-sm font-extrabold">
        {kind === "overall" ? formatRubCompact(data.capital ?? 0) : formatRub(data.profit, { sign: true })}
      </p>
    </div>
  );
}

/** Лидеры рейтинга для главной: пьедестал топ-3 и места 4–10. */
export function LeadersWidget() {
  const { user } = useAuth();
  const [kind, setKind] = useState<Kind>("overall");
  const { leaders, isLoading } = useLeaders(kind);
  const podium = leaders.slice(0, 3);
  const rest = leaders.slice(3, 10);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-gold/25 bg-surface-1 p-4">
      <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-gold/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -right-16 size-48 rounded-full bg-primary/10 blur-3xl" aria-hidden />

      <div className="relative flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
          <span className="flex size-8 items-center justify-center rounded-xl bg-gold/15 text-gold">
            <Trophy className="size-4" />
          </span>
          Лидеры
        </h2>
        <div className="flex rounded-xl bg-surface-2 p-0.5 text-xs font-bold" role="tablist" aria-label="Период рейтинга">
          {(["overall", "monthly"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 transition-colors",
                kind === k ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "overall" ? "Всё время" : "Месяц"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="relative mt-4 space-y-2">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : leaders.length === 0 ? (
        <p className="relative py-10 text-center text-sm text-muted-foreground">
          {kind === "monthly" ? "В этом месяце ещё нет рассчитанных прогнозов." : "Рейтинг пока пуст."}
        </p>
      ) : (
        <>
          <ol className="relative mt-5 grid grid-cols-3 items-end gap-2" aria-label="Топ-3">
            {PODIUM.map(({ index, ring, text, step, size }) => {
              const r = podium[index];
              if (!r) {
                return (
                  <li key={index} className="flex flex-col items-center text-center opacity-50">
                    <span className={cn(size, "rounded-full border-2 border-dashed border-white/20")} />
                    <p className="mt-2 text-xs font-semibold text-muted-foreground">Свободно</p>
                    <p className="text-xs">&nbsp;</p>
                    <div className={cn("mt-2 w-full rounded-t-xl bg-gradient-to-b to-transparent", step)} />
                  </li>
                );
              }
              return (
                <li key={r.user_id} className="flex min-w-0 flex-col items-center text-center">
                  {index === 0 ? <Crown className="mb-1 size-5 fill-gold text-gold" aria-hidden /> : null}
                  <UserAvatar nickname={r.nickname} url={r.avatar_url} className={cn(size, "ring-2 ring-offset-2 ring-offset-surface-1", ring)} />
                  <p className="mt-2 w-full truncate text-xs font-bold">{r.nickname}</p>
                  <p
                    className={cn(
                      "numeric text-xs font-extrabold",
                      r.positive === true ? "text-over" : r.positive === false ? "text-under" : "text-foreground",
                    )}
                  >
                    {r.value}
                  </p>
                  <div className={cn("mt-2 flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b to-transparent pt-1.5", step)}>
                    <span className={cn("numeric text-lg font-extrabold", text)}>{r.rank}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          {rest.length > 0 ? (
            <ol className="relative mt-3 divide-y divide-white/[0.05] rounded-2xl bg-surface-2/60">
              {rest.map((r) => (
                <li key={r.user_id} className={cn("flex items-center gap-2.5 px-3 py-2", r.user_id === user?.id && "bg-primary/10")}>
                  <span className="numeric w-5 text-center text-xs font-extrabold text-muted-foreground">{r.rank}</span>
                  <UserAvatar nickname={r.nickname} url={r.avatar_url} className="size-7" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.nickname}</span>
                  <span
                    className={cn(
                      "numeric text-sm font-extrabold",
                      r.positive === true ? "text-over" : r.positive === false ? "text-under" : "",
                    )}
                  >
                    {r.value}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}

      <div className="relative mt-3 space-y-3">
        {user ? <MyRank kind={kind} /> : null}
        <Link
          href="/leaderboard"
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-primary transition-colors hover:bg-primary/10"
        >
          Весь рейтинг <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}
