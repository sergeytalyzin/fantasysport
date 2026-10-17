"use client";

import { AlertTriangle, ArrowDown, ArrowUp, X } from "lucide-react";
import { PlayerPhoto } from "@/components/sports/player-photo";
import type { CouponPick } from "@/features/picks/coupon-logic";
import type { PickFreshness } from "@/features/picks/use-coupon-freshness";
import { formatKickoff, formatLine } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CouponPickRow({
  pick,
  freshness,
  onSwitch,
  onRemove,
  onAcceptLine,
}: {
  pick: CouponPick;
  freshness?: PickFreshness;
  onSwitch: () => void;
  onRemove: () => void;
  onAcceptLine: (line: number) => void;
}) {
  const over = pick.direction === "OVER";
  return (
    <li className="animate-rise rounded-2xl border border-white/[0.06] bg-surface-2 p-2.5">
      <div className="flex items-center gap-3">
        <PlayerPhoto name={pick.playerName} photoUrl={pick.photoUrl} teamColor={pick.teamColor} className="size-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{pick.playerName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {pick.leagueShort} · {pick.teamAbbr} vs {pick.opponentAbbr} · {formatKickoff(pick.startsAt)}
          </p>
          <p className="mt-0.5 text-xs">
            <span className="numeric font-bold">{formatLine(pick.line)}</span>{" "}
            <span className="text-muted-foreground">{pick.marketName}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitch}
          title="Сменить направление"
          className={cn(
            "flex h-9 items-center gap-1 rounded-xl px-2.5 text-xs font-extrabold transition-colors",
            over ? "bg-over/15 text-over" : "bg-under/15 text-under",
          )}
        >
          {over ? <ArrowUp className="size-3.5" strokeWidth={3} /> : <ArrowDown className="size-3.5" strokeWidth={3} />}
          {over ? "Больше" : "Меньше"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Убрать ${pick.playerName}`}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {freshness?.state === "changed" ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-gold/10 px-2.5 py-1.5 text-xs text-gold">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" /> Линия изменилась: {formatLine(pick.line)} → {formatLine(freshness.line)}
          </span>
          <button type="button" className="font-bold underline underline-offset-2" onClick={() => onAcceptLine(freshness.line)}>
            Принять
          </button>
        </div>
      ) : freshness?.state === "closed" ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          <AlertTriangle className="size-3.5" /> Приём прогнозов закрыт — уберите выбор
        </div>
      ) : null}
    </li>
  );
}
