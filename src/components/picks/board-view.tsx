"use client";

import { SearchX } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import type { CouponPick } from "@/features/picks/coupon-logic";
import { useBoard } from "@/features/projections/hooks";
import { useAppSettings } from "@/features/sports/hooks";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/errors";
import { useCouponStore } from "@/stores/coupon-store";
import type { BoardProjection, PickDirection } from "@/types/domain";
import { BoardFilters, type BoardFilterState } from "../sports/board-filters";
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

export function BoardView() {
  const [filters, setFilters] = useState<BoardFilterState>({ sport: null, league: null, market: null, search: "" });
  const search = useDebouncedValue(filters.search.trim().toLowerCase(), 250);
  const { data, isLoading, isError, error } = useBoard({ sport: filters.sport, league: filters.league });
  const { data: settings } = useAppSettings();
  const picks = useCouponStore((s) => s.picks);
  const toggle = useCouponStore((s) => s.toggle);

  const selected = useMemo(() => new Map(picks.map((p) => [p.projectionId, p.direction])), [picks]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.filter((p) => {
      if (filters.market && p.market.code !== filters.market) return false;
      if (!search) return true;
      const haystack = `${p.player.full_name} ${p.player.team?.name ?? ""} ${p.match.home.name} ${p.match.away.name}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [data, filters.market, search]);

  const onPick = useCallback(
    (projection: BoardProjection, direction: PickDirection) => {
      const max = settings?.max_picks ?? 6;
      const event = toggle(toPick(projection, direction), max);
      if (event === "limit") toast.warning(`В купоне может быть не больше ${max} прогнозов`);
      else if (TOASTS[event]) toast(TOASTS[event]);
    },
    [toggle, settings?.max_picks],
  );

  return (
    <div className="space-y-5">
      <BoardFilters value={filters} onChange={setFilters} />

      {isError ? (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Не удалось загрузить линии: {errorMessage(error)}
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[19.5rem] rounded-3xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-16 text-center">
          <SearchX className="size-10 text-muted-foreground" />
          <p className="font-semibold">Линий не найдено</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Попробуйте другой вид спорта или лигу. Новые линии появляются при каждой синхронизации.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((p, i) => (
            <div key={p.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
              <ProjectionCard projection={p} selected={selected.get(p.id) ?? null} onPick={onPick} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
