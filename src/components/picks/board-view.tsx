"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { CouponPick } from "@/features/picks/coupon-logic";
import { useAppSettings } from "@/features/sports/hooks";
import { cn } from "@/lib/utils";
import { useCouponStore } from "@/stores/coupon-store";
import type { BoardProjection, PickDirection } from "@/types/domain";

function toPick(p: BoardProjection, direction: PickDirection): CouponPick {
  const team = p.player.team;
  const opponent = team?.id === p.match.home.id ? p.match.away : p.match.home;
  return {
    projectionId: p.id,
    playerId: p.player.id,
    matchId: p.match.id,
    direction,
    line: p.line,
    playerName: p.player.full_name,
    photoUrl: p.player.photo_url,
    photoCredit: p.player,
    // Без известной команды показываем сам матч: «хозяева vs гости».
    teamAbbr: team?.abbr ?? p.match.home.abbr,
    teamColor: team?.color ?? null,
    opponentAbbr: team ? opponent.abbr : p.match.away.abbr,
    marketName: p.market.name,
    leagueShort: p.match.league.short_name,
    startsAt: p.match.starts_at,
  };
}

const TOASTS: Partial<Record<string, string>> = {
  replaced: "Один спортсмен — один прогноз: выбор заменён",
};

/** Выбор «Больше/Меньше» в купон и текущие выборы купона. */
export function usePickHandler() {
  const { data: settings } = useAppSettings();
  const picks = useCouponStore((s) => s.picks);
  const toggle = useCouponStore((s) => s.toggle);
  const selected = useMemo(() => new Map(picks.map((p) => [p.projectionId, p.direction])), [picks]);

  const onPick = useCallback(
    (projection: BoardProjection, direction: PickDirection) => {
      const max = settings?.max_picks ?? 6;
      const event = toggle(toPick(projection, direction), max);
      if (event === "limit") toast.warning(`В купоне может быть не больше ${max} прогнозов`);
      else if (TOASTS[event]) toast(TOASTS[event]);
    },
    [toggle, settings?.max_picks],
  );

  return { selected, onPick };
}

export function PickButton({ direction, active, onClick }: { direction: PickDirection; active: boolean; onClick: () => void }) {
  const over = direction === "OVER";
  const Icon = over ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-11 items-center justify-center gap-1 rounded-xl text-[0.8rem] font-extrabold transition-colors active:scale-95 sm:text-sm",
        active && "animate-pick-pop",
        over
          ? active
            ? "bg-over text-primary-foreground"
            : "bg-over/10 text-over hover:bg-over/20"
          : active
            ? "bg-under text-white"
            : "bg-under/10 text-under hover:bg-under/20",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={3} />
      {over ? "Больше" : "Меньше"}
    </button>
  );
}
