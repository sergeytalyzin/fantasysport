"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { upsertPayoutRule, useAdminMutation } from "@/features/admin/hooks";
import { usePayoutRules } from "@/features/sports/hooks";
import type { PayoutRule, PlayType } from "@/types/domain";
import { AdminPanel, ListSkeleton } from "./admin-ui";

const INVALIDATE = [["payout-rules"]];

function RuleRow({ rule }: { rule: PayoutRule }) {
  const [value, setValue] = useState(String(rule.multiplier));
  const mutation = useAdminMutation(upsertPayoutRule, "Множитель сохранён", INVALIDATE);
  const parsed = Number(value.replace(",", "."));
  const save = (isActive: boolean, multiplier = parsed) =>
    mutation.mutate({ playType: rule.play_type, picks: rule.picks_count, correct: rule.correct_count, multiplier, isActive });

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="w-40 shrink-0 font-semibold">
        {rule.correct_count} из {rule.picks_count}
      </span>
      <Input className="numeric h-9 w-24 text-center" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Множитель" />
      <Button size="sm" variant="outline" disabled={mutation.isPending || !(parsed >= 0) || parsed === Number(rule.multiplier)} onClick={() => save(rule.is_active)}>
        Сохранить
      </Button>
      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        Активен
        <Switch checked={rule.is_active} onCheckedChange={(v) => save(v, Number(rule.multiplier))} />
      </label>
    </li>
  );
}

function AddRule({ playType }: { playType: PlayType }) {
  const [picks, setPicks] = useState("");
  const [correct, setCorrect] = useState("");
  const [mult, setMult] = useState("");
  const mutation = useAdminMutation(upsertPayoutRule, "Правило добавлено", INVALIDATE);
  const p = Number(picks);
  const c = playType === "POWER" ? p : Number(correct);
  const m = Number(mult.replace(",", "."));
  const valid = p >= 2 && p <= 6 && c >= 0 && c <= p && m >= 0;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-3">
      <Input className="h-9 w-24" placeholder="Выборов" value={picks} onChange={(e) => setPicks(e.target.value)} />
      {playType === "FLEX" ? <Input className="h-9 w-24" placeholder="Угадано" value={correct} onChange={(e) => setCorrect(e.target.value)} /> : null}
      <Input className="h-9 w-24" placeholder="×" value={mult} onChange={(e) => setMult(e.target.value)} />
      <Button size="sm" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate({ playType, picks: p, correct: c, multiplier: m, isActive: true })}>
        Добавить / заменить
      </Button>
    </div>
  );
}

export function AdminPayouts() {
  const { data = [], isLoading } = usePayoutRules();
  return (
    <>
      <h1 className="text-2xl font-extrabold">Множители выплат</h1>
      <p className="text-sm text-muted-foreground">
        Изменения действуют только для новых купонов: в каждом купоне хранится снимок условий на момент подтверждения.
      </p>
      {(["POWER", "FLEX"] as const).map((type) => (
        <AdminPanel key={type} title={type === "POWER" ? "Power Play" : "Flex Play"}>
          {isLoading ? (
            <ListSkeleton rows={4} />
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {data
                .filter((r) => r.play_type === type)
                .map((r) => (
                  <RuleRow key={`${r.id}-${r.multiplier}-${r.is_active}`} rule={r} />
                ))}
            </ul>
          )}
          <AddRule playType={type} />
        </AdminPanel>
      ))}
    </>
  );
}
