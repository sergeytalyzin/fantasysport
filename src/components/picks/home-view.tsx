"use client";

import { CalendarDays, Users } from "lucide-react";
import { useState } from "react";
import { MatchesView } from "@/components/matches/matches-view";
import { BoardFilters, type BoardFilterState } from "@/components/sports/board-filters";
import { cn } from "@/lib/utils";
import { PlayersGrid } from "./board-view";

type View = "matches" | "players";

const VIEWS: { value: View; label: string; icon: typeof Users }[] = [
  { value: "matches", label: "Матчи", icon: CalendarDays },
  { value: "players", label: "Все игроки", icon: Users },
];

export function HomeView() {
  const [view, setView] = useState<View>("matches");
  const [filters, setFilters] = useState<BoardFilterState>({ sport: null, league: null, market: null, search: "" });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist" aria-label="Вид витрины">
        {VIEWS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              "flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors",
              view === value ? "bg-surface-3 text-foreground shadow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      <BoardFilters
        value={filters}
        onChange={setFilters}
        show={{ sports: true, markets: view === "players", search: view === "players" }}
      />

      {view === "matches" ? (
        <MatchesView sport={filters.sport} league={filters.league} />
      ) : (
        <PlayersGrid sport={filters.sport} league={filters.league} market={filters.market} search={filters.search} />
      )}
    </div>
  );
}
