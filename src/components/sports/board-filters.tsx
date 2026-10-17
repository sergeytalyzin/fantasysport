"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLeagues, useMarkets, useSports } from "@/features/sports/hooks";
import type { SportId } from "@/types/domain";
import { Chip, ChipRow } from "./chip";
import { SportIcon } from "./sport-icon";

export interface BoardFilterState {
  sport: SportId | null;
  league: string | null;
  market: string | null;
  search: string;
}

export function BoardFilters({
  value,
  onChange,
  show = { sports: true, markets: true, search: true },
}: {
  value: BoardFilterState;
  onChange: (next: BoardFilterState) => void;
  /** Какие блоки показывать: на странице матча вид спорта и лига уже известны. */
  show?: { sports?: boolean; markets?: boolean; search?: boolean };
}) {
  const { data: sports = [] } = useSports();
  const { data: leagues = [] } = useLeagues();
  const { data: markets = [] } = useMarkets();

  const sportLeagues = leagues.filter((l) => l.is_active && (!value.sport || l.sport_id === value.sport));
  const sportMarkets = value.sport ? markets.filter((m) => m.sport_id === value.sport) : [];

  return (
    <div className="space-y-3">
      {show.sports ? (
        <>
          <ChipRow>
            <Chip active={!value.sport} onClick={() => onChange({ ...value, sport: null, league: null, market: null })}>
              <SportIcon sport="all" /> Все
            </Chip>
            {sports.map((s) => (
              <Chip
                key={s.id}
                active={value.sport === s.id}
                onClick={() => onChange({ ...value, sport: s.id, league: null, market: null })}
              >
                <SportIcon sport={s.id} /> {s.name}
              </Chip>
            ))}
          </ChipRow>

          <ChipRow>
            <Chip active={!value.league} onClick={() => onChange({ ...value, league: null })} className="h-8 text-xs">
              Все лиги
            </Chip>
            {sportLeagues.map((l) => (
              <Chip
                key={l.code}
                active={value.league === l.code}
                onClick={() => onChange({ ...value, league: l.code, sport: l.sport_id })}
                className="h-8 text-xs"
              >
                {l.short_name}
              </Chip>
            ))}
          </ChipRow>
        </>
      ) : null}

      {show.markets && sportMarkets.length > 0 ? (
        <ChipRow>
          <Chip active={!value.market} onClick={() => onChange({ ...value, market: null })} className="h-8 text-xs">
            Все показатели
          </Chip>
          {sportMarkets.map((m) => (
            <Chip
              key={m.code}
              active={value.market === m.code}
              onClick={() => onChange({ ...value, market: m.code })}
              className="h-8 text-xs"
            >
              {m.name}
            </Chip>
          ))}
        </ChipRow>
      ) : null}

      {show.search ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
            placeholder="Найти спортсмена или команду"
            className="pl-10"
            aria-label="Поиск спортсмена"
          />
        </label>
      ) : null}
    </div>
  );
}
