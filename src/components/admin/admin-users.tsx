"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { type AdminUser, adjustBalance, setUserRole, useAdminMutation, useAdminUsers } from "@/features/admin/hooks";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatRub } from "@/lib/format";
import { AdminPanel, ListSkeleton, StatusPill } from "./admin-ui";

function AdjustDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const mutation = useAdminMutation(adjustBalance, "Баланс скорректирован", [["admin"]]);
  const rub = Number(amount.replace(",", "."));
  const valid = Number.isFinite(rub) && rub !== 0 && reason.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Корректировка: {user.nickname}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Текущий баланс: {formatRub(user.balance)}. Операция попадёт в журнал аудита.</p>
        <FormField id="amount" label="Сумма, ₽ (отрицательная — списание)">
          <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="например, 5000 или -1000" />
        </FormField>
        <FormField id="reason" label="Причина">
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Компенсация за сбой" />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={!valid || mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { userId: user.user_id, amountKopecks: Math.round(rub * 100), reason: reason.trim() },
                { onSuccess: onClose },
              )
            }
          >
            Применить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminUsers() {
  const [input, setInput] = useState("");
  const search = useDebouncedValue(input.trim(), 300);
  const { data = [], isLoading } = useAdminUsers(search);
  const [adjusting, setAdjusting] = useState<AdminUser | null>(null);
  const roleMutation = useAdminMutation(setUserRole, "Роль обновлена", [["admin", "users"]]);

  return (
    <>
      <h1 className="text-2xl font-extrabold">Пользователи и кошельки</h1>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Никнейм или email" className="pl-10" />
      </label>
      <AdminPanel title={`Найдено: ${data.length}`}>
        {isLoading ? (
          <ListSkeleton />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.map((u) => (
              <li key={u.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    {u.nickname} {u.role === "admin" ? <StatusPill tone="brand">admin</StatusPill> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email} · с {formatDate(u.created_at)} · купонов: {u.lineups_total}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="numeric text-sm font-bold">{formatRub(u.balance)}</p>
                  <p className="text-muted-foreground">
                    резерв {formatRub(u.reserved)} · прибыль {formatRub(u.capital - u.funded_total, { sign: true })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAdjusting(u)}>
                    Баланс
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={roleMutation.isPending}
                    onClick={() => roleMutation.mutate({ userId: u.user_id, role: u.role === "admin" ? "user" : "admin" })}
                  >
                    {u.role === "admin" ? "Снять админа" : "Сделать админом"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
      {adjusting ? <AdjustDialog user={adjusting} onClose={() => setAdjusting(null)} /> : null}
    </>
  );
}
