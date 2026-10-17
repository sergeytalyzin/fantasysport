"use client";

import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { runMonthlyBonuses, updateSetting, useAdminMutation, useAdminSettings } from "@/features/admin/hooks";
import { formatDateTime } from "@/lib/format";
import { AdminPanel, ListSkeleton } from "./admin-ui";

// Денежные настройки хранятся в копейках; в интерфейсе — рубли.
const MONEY_KEYS = new Set(["initial_bonus_amount", "monthly_bonus_amount", "min_stake", "max_stake"]);
const INVALIDATE = [["admin", "settings"], ["app-settings"]];

function SettingRow({ setting }: { setting: { key: string; value: number | boolean; description: string | null; updated_at: string } }) {
  const money = MONEY_KEYS.has(setting.key);
  const [value, setValue] = useState(typeof setting.value === "number" ? String(money ? setting.value / 100 : setting.value) : "");
  const mutation = useAdminMutation(updateSetting, "Настройка сохранена", INVALIDATE);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{setting.description ?? setting.key}</p>
        <p className="text-xs text-muted-foreground">
          {setting.key} · изменено {formatDateTime(setting.updated_at)}
        </p>
      </div>
      {typeof setting.value === "boolean" ? (
        <Switch checked={setting.value} onCheckedChange={(v) => mutation.mutate({ key: setting.key, value: v })} />
      ) : (
        <div className="flex items-center gap-2">
          <Input className="numeric h-9 w-32 text-right" value={value} onChange={(e) => setValue(e.target.value)} />
          {money ? <span className="text-sm text-muted-foreground">₽</span> : null}
          <Button
            size="sm"
            variant="outline"
            disabled={mutation.isPending || !Number.isFinite(Number(value))}
            onClick={() => mutation.mutate({ key: setting.key, value: money ? Math.round(Number(value) * 100) : Number(value) })}
          >
            OK
          </Button>
        </div>
      )}
    </li>
  );
}

export function AdminSettings() {
  const { data = [], isLoading } = useAdminSettings();
  const bonuses = useAdminMutation(runMonthlyBonuses, "Начисление выполнено", [["admin"]]);
  return (
    <>
      <h1 className="text-2xl font-extrabold">Настройки</h1>
      <AdminPanel
        title="Ежемесячный бонус и лимиты"
        actions={
          <Button size="sm" onClick={() => bonuses.mutate(undefined)} disabled={bonuses.isPending}>
            <CalendarPlus /> Начислить пропущенные бонусы
          </Button>
        }
      >
        {isLoading ? (
          <ListSkeleton />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.map((s) => (
              <SettingRow key={`${s.key}-${s.updated_at}`} setting={s} />
            ))}
          </ul>
        )}
      </AdminPanel>
      <p className="text-xs text-muted-foreground">
        Бонус начисляется автоматически 1-го числа в 00:00 МСК (Supabase Cron) и ежечасно догоняет пропущенные месяцы.
        Ручной запуск безопасен: каждый пользователь получает бонус не более одного раза за календарный месяц.
      </p>
    </>
  );
}
