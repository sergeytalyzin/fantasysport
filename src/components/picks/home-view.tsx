"use client";

import { CalendarDays, Flame, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { MatchesView } from "@/components/matches/matches-view";
import { ScheduleView } from "@/components/matches/schedule-view";
import { BoardFilters, type BoardFilterState, type LeagueChip } from "@/components/sports/board-filters";
import { useMatches } from "@/features/matches/hooks";
import { cn } from "@/lib/utils";
import { PlayersGrid } from "./board-view";

type View = "lines" | "schedule" | "players";

const VIEWS: { value: View; label: string; icon: typeof Users }[] = [
  { value: "lines", label: "С линиями", icon: Flame },
  { value: "schedule", label: "Все события", icon: CalendarDays },
  { value: "players", label: "Игроки", icon: Users },
];

export function HomeView() {
  const [chosen, setView] = useState<View | null>(null);
  const [filters, setFilters] = useState<BoardFilterState>({ sport: null, league: null, market: null, search: "" });

  // Лиги для фильтра — только те, где сейчас есть линии.
  const { data: withLines = [], isSuccess } = useMatches({ sport: null, league: null });
  // Пока линий нет, витрина открывается на полном расписании.
  const view: View = chosen ?? (isSuccess && withLines.length === 0 ? "schedule" : "lines");
  const leagues = useMemo(() => {
    const map = new Map<string, LeagueChip>();
    for (const m of withLines) map.set(m.league.code, m.league);
    return [...map.values()];
  }, [withLines]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist" aria-label="Вид витрины">
        {VIEWS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-1 text-[0.8rem] font-bold transition-colors sm:gap-2 sm:text-sm",
              view === value ? "bg-surface-3 text-foreground shadow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 max-[399px]:hidden" /> <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <BoardFilters
        value={filters}
        onChange={setFilters}
        leagues={view === "schedule" ? [] : leagues}
        show={{ sports: true, markets: view === "players", search: view === "players" }}
      />

      {view === "lines" ? (
        <MatchesView sport={filters.sport} league={filters.league} />
      ) : view === "schedule" ? (
        <ScheduleView sport={filters.sport} />
      ) : (
        <PlayersGrid sport={filters.sport} league={filters.league} market={filters.market} search={filters.search} />
      )}
    </div>
  );
}
