"use client";

import { ArrowDownLeft, ArrowUpRight, CalendarPlus, Gift, Loader2, RotateCcw, Settings2, Trophy } from "lucide-react";
import { EmptyState } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTransactions } from "@/features/wallet/hooks";
import { formatDateTime, formatRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WalletTxType } from "@/types/domain";

const TYPES: Record<WalletTxType, { label: string; icon: typeof Gift; className: string }> = {
  INITIAL_BONUS: { label: "Стартовый бонус", icon: Gift, className: "bg-primary/15 text-primary" },
  MONTHLY_BONUS: { label: "Ежемесячный бонус", icon: CalendarPlus, className: "bg-primary/15 text-primary" },
  PICK_STAKE: { label: "Прогноз", icon: ArrowUpRight, className: "bg-white/10 text-muted-foreground" },
  PICK_WIN: { label: "Выигрыш", icon: Trophy, className: "bg-over/15 text-over" },
  PICK_REFUND: { label: "Возврат", icon: RotateCcw, className: "bg-white/10 text-foreground" },
  ADMIN_ADJUSTMENT: { label: "Корректировка", icon: Settings2, className: "bg-gold/15 text-gold" },
};

export function TransactionList() {
  const query = useTransactions();
  const rows = query.data?.pages.flat() ?? [];

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return <EmptyState icon={<ArrowDownLeft className="size-10" />} title="Операций пока нет" />;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
        {rows.map((tx) => {
          const t = TYPES[tx.type];
          const Icon = t.icon;
          return (
            <li key={tx.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", t.className)}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{tx.description ?? t.label}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(tx.created_at)}</p>
              </div>
              <div className="text-right">
                <p className={cn("numeric text-sm font-extrabold", tx.amount > 0 ? "text-over" : "text-foreground")}>
                  {formatRub(tx.amount, { sign: true })}
                </p>
                <p className="text-[0.7rem] text-muted-foreground">Баланс {formatRub(tx.balance_after)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null} Показать ещё
          </Button>
        </div>
      ) : null}
    </div>
  );
}
