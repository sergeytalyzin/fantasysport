"use client";

import { ArrowRight, Trophy } from "lucide-react";
import Link from "next/link";
import { UserAvatar } from "@/components/layout/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/auth-provider";
import { useMyRoiRank, useRoiLeaderboard } from "@/features/leaderboard/hooks";
import { useProfileSummary } from "@/features/profile/hooks";
import { formatRub, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const TOP = 5;

// Медали за 1–3 место; остальные — нейтральная плашка.
const RANK_STYLE: Record<number, string> = {
  1: "bg-gradient-to-br from-[#ffe48a] to-gold text-[#3a2a08]",
  2: "bg-gradient-to-br from-white to-silver text-[#1b222d]",
  3: "bg-gradient-to-br from-[#f3b98a] to-bronze text-[#3a1f08]",
};

interface RowData {
  rank: number;
  nickname: string;
  avatarUrl: string | null;
  lineups: number;
  roi: number;
  profit: number;
}

const roiFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function ForecasterRow({ row, me = false }: { row: RowData; me?: boolean }) {
  const positive = row.profit > 0;
  return (
    <li
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-2xl border bg-surface-2/70 py-2.5 pl-3 pr-2.5 transition-colors",
        me ? "border-primary/50 bg-primary/[0.07]" : "border-white/[0.07] hover:border-white/15",
      )}
    >
      <span
        className={cn(
          "numeric absolute left-0 top-0 flex size-5 items-center justify-center rounded-br-lg text-[0.65rem] font-extrabold",
          RANK_STYLE[row.rank] ?? "bg-surface-3 text-muted-foreground",
        )}
      >
        {row.rank}
      </span>
      <UserAvatar nickname={row.nickname} url={row.avatarUrl} className="ml-2 size-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          {row.nickname}
          {me ? <span className="ml-1.5 text-xs font-semibold text-primary">вы</span> : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="text-muted-foreground">
            {row.lineups} {plural(row.lineups, ["прогноз", "прогноза", "прогнозов"])}
          </span>
          <span className={cn("numeric font-bold", row.roi > 0 ? "text-over" : row.roi < 0 ? "text-under" : "text-muted-foreground")}>
            {roiFormatter.format(row.roi)}% ROI
          </span>
        </p>
      </div>
      <span
        className={cn(
          "numeric shrink-0 rounded-xl px-2.5 py-2 text-right text-sm font-extrabold leading-tight",
          positive ? "bg-over/10 text-over" : "bg-white/[0.05] text-muted-foreground",
        )}
      >
        {formatRub(row.profit, { sign: true })}
      </span>
    </li>
  );
}

/** Место текущего пользователя, если он ниже первой пятёрки. */
function MyPlace() {
  const { data: me } = useMyRoiRank();
  const { data: profile } = useProfileSummary();
  if (!me || !profile || me.rank <= TOP) return null;
  return (
    <section className="rounded-3xl border border-primary/25 bg-surface-1 p-3" aria-label="Ваше место в рейтинге прогнозистов">
      <p className="mb-2 px-1 text-xs font-semibold text-muted-foreground">
        Ваше место — {me.rank} из {me.total_players}
      </p>
      <ul>
        <ForecasterRow
          me
          row={{ rank: me.rank, nickname: profile.nickname, avatarUrl: profile.avatar_url, lineups: me.lineups_settled, roi: me.roi, profit: me.profit }}
        />
      </ul>
    </section>
  );
}

/** Рейтинг прогнозистов: топ-5 по ROI за текущий месяц. */
export function ForecastersRating() {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = useRoiLeaderboard(TOP);

  return (
    <div className="space-y-3">
      <section className="relative overflow-hidden rounded-3xl border border-gold/25 bg-surface-1 p-4">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-gold/15 blur-3xl" aria-hidden />
        <h2 className="relative flex items-center gap-2 font-display text-lg font-extrabold">
          <span className="flex size-8 items-center justify-center rounded-xl bg-gold/15 text-gold">
            <Trophy className="size-4" />
          </span>
          Рейтинг прогнозистов
        </h2>
        <p className="relative mt-1 text-xs text-muted-foreground">ROI рассчитанных прогнозов за текущий месяц</p>

        {isLoading ? (
          <div className="relative mt-4 space-y-2">
            {Array.from({ length: TOP }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="relative py-8 text-center text-sm text-muted-foreground">
            В этом месяце ещё нет рассчитанных прогнозов. Первый рассчитанный купон откроет рейтинг.
          </p>
        ) : (
          <ol className="relative mt-4 space-y-2">
            {rows.map((r) => (
              <ForecasterRow
                key={r.user_id}
                me={r.user_id === user?.id}
                row={{ rank: r.rank, nickname: r.nickname, avatarUrl: r.avatar_url, lineups: r.lineups_settled, roi: r.roi, profit: r.profit }}
              />
            ))}
          </ol>
        )}

        <Link
          href="/leaderboard"
          className="relative mt-3 flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-primary transition-colors hover:bg-primary/10"
        >
          Весь рейтинг <ArrowRight className="size-4" />
        </Link>
      </section>
      {user ? <MyPlace /> : null}
    </div>
  );
}
