"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/auth-provider";
import { findMultiplier, flexTable, potentialPayout } from "@/features/picks/coupon-logic";
import { useCreateLineup } from "@/features/picks/hooks";
import { useCouponFreshness } from "@/features/picks/use-coupon-freshness";
import { useAppSettings, usePayoutRules } from "@/features/sports/hooks";
import { useWallet } from "@/features/wallet/hooks";
import { toAppError } from "@/lib/errors";
import { formatMultiplier, formatRub, plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { stakeSchema } from "@/lib/validations/lineup";
import { useCouponStore } from "@/stores/coupon-store";
import { CouponPickRow } from "./coupon-pick-row";
import { PlayTypeToggle } from "./play-type-toggle";
import { StakeInput } from "./stake-input";

export function CouponPanel({ onSubmitted }: { onSubmitted?: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { picks, playType, stake, idempotencyKey, toggle, remove, updateLine, setPlayType, setStake, reset } =
    useCouponStore();
  const { data: settings } = useAppSettings();
  const { data: rules = [] } = usePayoutRules();
  const { data: wallet } = useWallet();
  const { data: freshness } = useCouponFreshness(picks);
  const createLineup = useCreateLineup();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const minPicks = settings?.min_picks ?? 2;
  const maxPicks = settings?.max_picks ?? 6;
  const flexMin = settings?.flex_min_picks ?? 3;
  const count = picks.length;
  const flexDisabledReason = count < flexMin ? `От ${flexMin} выборов` : null;
  const effectiveType = playType === "FLEX" && flexDisabledReason ? "POWER" : playType;
  const multiplier = count >= minPicks ? findMultiplier(rules, effectiveType, count) : null;
  const flexRows = effectiveType === "FLEX" ? flexTable(rules, count) : [];

  const stakeRub = Number(stake || 0);
  const stakeError = useMemo(() => {
    if (!settings || !stake) return stake ? null : "Введите сумму";
    const parsed = stakeSchema(settings, wallet?.balance ?? null).safeParse(stakeRub);
    return parsed.success ? null : parsed.error.issues[0].message;
  }, [settings, stake, stakeRub, wallet?.balance]);

  const blocked = Object.values(freshness ?? {}).some((f) => f.state !== "ok");
  const canSubmit = Boolean(user) && count >= minPicks && multiplier !== null && !stakeError && !blocked;
  const payout = potentialPayout(stakeRub, multiplier);

  const submit = () => {
    if (!multiplier) return;
    createLineup.mutate(
      { playType: effectiveType, stakeRub, picks, expectedMultiplier: multiplier, idempotencyKey },
      {
        onSuccess: (lineup) => {
          setConfirmOpen(false);
          toast.success(`Прогноз принят! Возможная выплата — ${formatRub(lineup.potential_payout)}`);
          reset();
          onSubmitted?.();
        },
        onError: (error) => {
          setConfirmOpen(false);
          const { message, code } = toAppError(error);
          toast.error(message);
          if (code && ["LINE_CHANGED", "PROJECTION_CLOSED", "PROJECTION_NOT_FOUND", "MULTIPLIER_CHANGED"].includes(code)) {
            void queryClient.invalidateQueries({ queryKey: ["coupon-freshness"] });
            void queryClient.invalidateQueries({ queryKey: queryKeys.boardAll });
            void queryClient.invalidateQueries({ queryKey: queryKeys.payoutRules });
          }
        },
      },
    );
  };

  if (count === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="size-7" />
        </div>
        <p className="font-display text-base font-bold">Купон пуст</p>
        <p className="text-sm text-muted-foreground">
          Выберите от {minPicks} до {maxPicks} прогнозов «Больше» или «Меньше», чтобы собрать купон.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">
          Купон <span className="text-muted-foreground">· {count}</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
          <Trash2 /> Очистить
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {picks.map((pick) => (
          <CouponPickRow
            key={pick.projectionId}
            pick={pick}
            freshness={freshness?.[pick.projectionId]}
            onSwitch={() => toggle({ ...pick, direction: pick.direction === "OVER" ? "UNDER" : "OVER" }, maxPicks)}
            onRemove={() => remove(pick.projectionId)}
            onAcceptLine={(line) => updateLine(pick.projectionId, line)}
          />
        ))}
      </ul>

      {count < minPicks ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-center text-sm text-muted-foreground">
          Добавьте ещё {minPicks - count} {plural(minPicks - count, ["прогноз", "прогноза", "прогнозов"])}
        </p>
      ) : null}

      <PlayTypeToggle value={effectiveType} onChange={setPlayType} flexDisabledReason={flexDisabledReason} />

      {count >= minPicks ? (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-2 p-3 text-sm">
          {effectiveType === "POWER" ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {count} из {count} — все должны сыграть
              </span>
              <span className="numeric font-extrabold text-primary">{multiplier ? formatMultiplier(multiplier) : "—"}</span>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {flexRows.map((row) => (
                <li key={row.correct} className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Угадано {row.correct} из {count}
                  </span>
                  <span className={cn("numeric font-extrabold", row.correct === count ? "text-primary" : "text-foreground")}>
                    {formatMultiplier(row.multiplier)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <StakeInput value={stake} onChange={setStake} balance={wallet?.balance ?? null} error={user ? stakeError : null} />

      <div className="flex items-end justify-between rounded-2xl bg-gradient-to-br from-primary/15 to-transparent p-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Возможная выплата</p>
          <p className="numeric text-2xl font-extrabold text-primary">{formatRub(payout)}</p>
        </div>
        {multiplier ? <span className="numeric text-lg font-bold">{formatMultiplier(multiplier)}</span> : null}
      </div>

      {user ? (
        <Button size="lg" className="w-full" disabled={!canSubmit || createLineup.isPending} onClick={() => setConfirmOpen(true)}>
          {createLineup.isPending ? <Loader2 className="animate-spin" /> : null}
          Сделать прогноз
        </Button>
      ) : (
        <Button size="lg" className="w-full" asChild>
          <Link href="/login?next=/">Войдите, чтобы сделать прогноз</Link>
        </Button>
      )}
      <p className="text-center text-[0.7rem] text-muted-foreground">
        Только виртуальные рубли. Без реальных денег, депозитов и выводов.
      </p>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Подтвердите прогноз</DialogTitle>
            <DialogDescription>
              {effectiveType === "POWER" ? "Power Play" : "Flex Play"}, {count}{" "}
              {plural(count, ["выбор", "выбора", "выборов"])}. Линии и множители будут зафиксированы.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
            <dt className="text-muted-foreground">Сумма</dt>
            <dd className="numeric text-right font-bold">{formatRub(stakeRub * 100)}</dd>
            <dt className="text-muted-foreground">Множитель</dt>
            <dd className="numeric text-right font-bold">{multiplier ? formatMultiplier(multiplier) : "—"}</dd>
            <dt className="text-muted-foreground">Возможная выплата</dt>
            <dd className="numeric text-right font-extrabold text-primary">{formatRub(payout)}</dd>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={createLineup.isPending}>
              {createLineup.isPending ? <Loader2 className="animate-spin" /> : null}
              Подтвердить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
