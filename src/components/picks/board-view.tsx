"use client";

import { SearchX } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import type { CouponPick } from "@/features/picks/coupon-logic";
import { useBoard } from "@/features/projections/hooks";
import { useAppSettings } from "@/features/sports/hooks";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/errors";
import { useCouponStore } from "@/stores/coupon-store";
import type { BoardProjection, PickDirection } from "@/types/domain";
import { ProjectionCard } from "./projection-card";

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

export interface PlayersGridProps {
  sport?: string | null;
  league?: string | null;
  matchId?: string | null;
  market?: string | null;
  search?: string;
  /** Только спортсмены этой команды. */
  teamId?: string | null;
}

/** Сетка карточек «Больше/Меньше» с добавлением в купон. */
export function PlayersGrid({ sport = null, league = null, matchId = null, market = null, search = "", teamId = null }: PlayersGridProps) {
  const query = useDebouncedValue(search.trim().toLowerCase(), 250);
  const { data, isLoading, isError, error } = useBoard({ sport, league, matchId });
  const { data: settings } = useAppSettings();
  const picks = useCouponStore((s) => s.picks);
  const toggle = useCouponStore((s) => s.toggle);

  const selected = useMemo(() => new Map(picks.map((p) => [p.projectionId, p.direction])), [picks]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.filter((p) => {
      if (market && p.market.code !== market) return false;
      if (teamId && p.player.team?.id !== teamId) return false;
      if (!query) return true;
      const haystack = `${p.player.full_name} ${p.player.team?.name ?? ""} ${p.match.home.name} ${p.match.away.name}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [data, market, teamId, query]);

  const onPick = useCallback(
    (projection: BoardProjection, direction: PickDirection) => {
      const max = settings?.max_picks ?? 6;
      const event = toggle(toPick(projection, direction), max);
      if (event === "limit") toast.warning(`В купоне может быть не больше ${max} прогнозов`);
      else if (TOASTS[event]) toast(TOASTS[event]);
    },
    [toggle, settings?.max_picks],
  );

  if (isError) {
    return (
      <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        Не удалось загрузить линии: {errorMessage(error)}
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[19.5rem] rounded-3xl" />
        ))}
      </div>
    );
  }
  if (visible.length === 0) {
    const filtered = Boolean(data?.length);
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-16 text-center">
        <SearchX className="size-10 text-muted-foreground" />
        <p className="font-semibold">{filtered ? "Линий не найдено" : "Открытых линий сейчас нет"}</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {filtered
            ? "Попробуйте другой показатель или фильтр."
            : "Линии на игроков публикуют букмекеры — обычно в день матча. Они появятся здесь после ближайшей синхронизации."}
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {visible.map((p, i) => (
        <div key={p.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
          <ProjectionCard projection={p} selected={selected.get(p.id) ?? null} onPick={onPick} linkToMatch={!matchId} />
        </div>
      ))}
    </div>
  );
}
