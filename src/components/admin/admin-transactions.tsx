"use client";

import { useState } from "react";
import { Chip, ChipRow } from "@/components/sports/chip";
import { useAdminTransactions } from "@/features/admin/hooks";
import { formatDateTime, formatRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WalletTxType } from "@/types/domain";
import { AdminPanel, ListSkeleton, StatusPill } from "./admin-ui";

const TYPES: { value: WalletTxType | null; label: string }[] = [
  { value: null, label: "Все" },
  { value: "INITIAL_BONUS", label: "Стартовые" },
  { value: "MONTHLY_BONUS", label: "Ежемесячные" },
  { value: "PICK_STAKE", label: "Ставки" },
  { value: "PICK_WIN", label: "Выигрыши" },
  { value: "PICK_REFUND", label: "Возвраты" },
  { value: "ADMIN_ADJUSTMENT", label: "Корректировки" },
];

export function AdminTransactions() {
  const [type, setType] = useState<WalletTxType | null>(null);
  const { data = [], isLoading } = useAdminTransactions(type);

  return (
    <>
      <h1 className="text-2xl font-extrabold">История операций</h1>
      <ChipRow className="mx-0 px-0">
        {TYPES.map((t) => (
          <Chip key={t.label} active={type === t.value} onClick={() => setType(t.value)} className="h-8 text-xs">
            {t.label}
          </Chip>
        ))}
      </ChipRow>
      <AdminPanel title="Последние 200 операций">
        {isLoading ? (
          <ListSkeleton />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">#{tx.id}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {tx.wallet.profile.nickname} <StatusPill tone="muted">{tx.type}</StatusPill>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(tx.created_at)} · {tx.description}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cn("numeric font-bold", tx.amount > 0 ? "text-over" : "text-under")}>
                    {formatRub(tx.amount, { sign: true })}
                  </p>
                  <p className="text-xs text-muted-foreground">→ {formatRub(tx.balance_after)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
    </>
  );
}
