"use client";

import { CalendarClock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppSettings } from "@/features/sports/hooks";
import { useWallet } from "@/features/wallet/hooks";
import { formatRub, nextMonthStartLabel } from "@/lib/format";

export function WalletOverview() {
  const { data: wallet, isLoading } = useWallet();
  const { data: settings } = useAppSettings();

  if (isLoading || !wallet) return <Skeleton className="h-52 rounded-3xl" />;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-surface-1 to-surface-1 p-5 sm:p-7">
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/20 blur-3xl" aria-hidden />
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Доступный баланс</p>
      <p className="numeric mt-1 text-4xl font-extrabold sm:text-5xl">{formatRub(wallet.balance)}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-black/20 p-3">
          <dt className="text-xs text-muted-foreground">В активных прогнозах</dt>
          <dd className="numeric mt-0.5 font-bold">{formatRub(wallet.reserved)}</dd>
        </div>
        <div className="rounded-2xl bg-black/20 p-3">
          <dt className="text-xs text-muted-foreground">Капитал</dt>
          <dd className="numeric mt-0.5 font-bold">{formatRub(wallet.capital)}</dd>
        </div>
      </dl>
      {settings?.monthly_bonus_enabled ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="size-4 text-primary" />
          {nextMonthStartLabel()} в 00:00 МСК — ещё{" "}
          {formatRub(settings.monthly_bonus_amount)}. Баланс никогда не обнуляется.
        </p>
      ) : null}
    </section>
  );
}
