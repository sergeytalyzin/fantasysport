"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import { ScheduleSearch, ScheduleView } from "@/components/matches/schedule-view";
import { Chip, ChipRow } from "@/components/sports/chip";
import { SportIcon } from "@/components/sports/sport-icon";
import { Input } from "@/components/ui/input";
import { useSports } from "@/features/sports/hooks";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { HOME_SPORTS } from "@/lib/featured";
import type { SportId } from "@/types/domain";

/**
 * Главная: поиск по всей линии и матчи популярных лиг выбранного вида спорта.
 * Поиск не зависит от выбранного вида спорта и дня.
 */
export function HomeView() {
  const [sport, setSport] = useState<SportId>(HOME_SPORTS[0]);
  const [input, setInput] = useState("");
  const search = useDebouncedValue(input.trim().toLowerCase(), 250);
  const { data: sports = [] } = useSports();
  const names = new Map(sports.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Команда, турнир, страна, игрок"
          className="pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
          aria-label="Поиск по всем матчам"
          enterKeyHint="search"
        />
        {input ? (
          <button
            type="button"
            onClick={() => setInput("")}
            className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Очистить поиск"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </label>

      {search ? (
        <ScheduleSearch search={search} />
      ) : (
        <>
          <ChipRow aria-label="Вид спорта">
            {HOME_SPORTS.filter((id) => names.has(id)).map((id) => (
              <Chip key={id} active={sport === id} onClick={() => setSport(id)}>
                <SportIcon sport={id} /> {names.get(id)}
              </Chip>
            ))}
          </ChipRow>
          <ScheduleView key={sport} sport={sport} />
        </>
      )}
    </div>
  );
}
