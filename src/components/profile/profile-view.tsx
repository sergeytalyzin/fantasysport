"use client";

import { CalendarPlus, Gift } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileSummary } from "@/features/profile/hooks";
import { useBonusGrants } from "@/features/wallet/hooks";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatNumber, formatPercent, formatPeriod, formatRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProfileEditor } from "./profile-editor";

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-1 p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn("numeric mt-1 text-xl font-extrabold", className)}>{value}</p>
    </div>
  );
}

function BonusHistory() {
  const { data = [], isLoading } = useBonusGrants();
  if (isLoading) return <Skeleton className="h-32 rounded-3xl" />;
  return (
    <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
      {data.map((g) => (
        <li key={g.id} className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            {g.kind === "REGISTRATION" ? <Gift className="size-4" /> : <CalendarPlus className="size-4" />}
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">{g.kind === "REGISTRATION" ? "Стартовый бонус" : "Ежемесячный бонус"}</p>
            <p className="text-xs text-muted-foreground">
              {formatPeriod(g.year, g.month)} · {formatDateTime(g.created_at)}
            </p>
          </div>
          <p className="numeric text-sm font-extrabold text-over">{formatRub(g.amount, { sign: true })}</p>
        </li>
      ))}
    </ul>
  );
}

export function ProfileView() {
  const { data: profile, isLoading, error } = useProfileSummary();

  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (isLoading || !profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProfileEditor profile={profile} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Баланс" value={formatRub(profile.balance)} />
        <Stat
          label="Прибыль за всё время"
          value={formatRub(profile.profit, { sign: true })}
          className={profile.profit > 0 ? "text-over" : profile.profit < 0 ? "text-under" : undefined}
        />
        <Stat label="Место в рейтинге" value={`${profile.overall_rank} из ${profile.total_players}`} className="text-primary" />
        <Stat label="Прогнозов" value={formatNumber(profile.lineups_total)} />
        <Stat label="Рассчитано" value={formatNumber(profile.lineups_settled)} />
        <Stat label="Успешных" value={formatPercent(profile.win_rate)} />
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">История начислений</h2>
        <BonusHistory />
      </section>
    </div>
  );
}
