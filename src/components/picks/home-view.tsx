"use client";

import { useState } from "react";
import { ScheduleView } from "@/components/matches/schedule-view";
import { Chip, ChipRow } from "@/components/sports/chip";
import { SportIcon } from "@/components/sports/sport-icon";
import { useSports } from "@/features/sports/hooks";
import { HOME_SPORTS } from "@/lib/featured";
import type { SportId } from "@/types/domain";

/** Главная: виды спорта в заданном порядке и матчи популярных лиг выбранного вида. */
export function HomeView() {
  const [sport, setSport] = useState<SportId>(HOME_SPORTS[0]);
  const { data: sports = [] } = useSports();
  const names = new Map(sports.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      <ChipRow aria-label="Вид спорта">
        {HOME_SPORTS.filter((id) => names.has(id)).map((id) => (
          <Chip key={id} active={sport === id} onClick={() => setSport(id)}>
            <SportIcon sport={id} /> {names.get(id)}
          </Chip>
        ))}
      </ChipRow>
      <ScheduleView key={sport} sport={sport} />
    </div>
  );
}
