"use client";

import { CalendarX2, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { Chip, ChipRow } from "@/components/sports/chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type ScheduleDay, type ScheduleItem, useSchedule } from "@/features/matches/hooks";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/errors";
import { plural } from "@/lib/format";
import type { SportId } from "@/types/domain";
import { MatchRow } from "./match-cards";

const DAYS: { value: ScheduleDay; label: string }[] = [
  { value: "today", label: "Сегодня" },
  { value: "tomorrow", label: "Завтра" },
  { value: "upcoming", label: "Ближайшие дни" },
];

const PAGE = 20;
const ROWS_PER_LEAGUE = 8;

interface Group {
  key: string;
  title: string;
  country: string | null;
  lines: number;
  /** Порядок популярных лиг; у киберспорта — null (по времени начала). */
  rank: number | null;
  matches: ScheduleItem[];
}

function LeagueGroup({ group }: { group: Group }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.matches : group.matches.slice(0, ROWS_PER_LEAGUE);
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <h3 className="min-w-0 truncate font-sans text-sm font-bold tracking-normal">
          {group.country ? <span className="text-muted-foreground">{group.country} · </span> : null}
          {group.title}
        </h3>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{group.matches.length}</span>
      </header>
      <div className="divide-y divide-white/[0.05]">
        {visible.map((m) => (
          <MatchRow key={m.id} match={m} />
        ))}
      </div>
      {group.matches.length > ROWS_PER_LEAGUE ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full items-center justify-center gap-1 border-t border-white/[0.06] text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Свернуть" : `Ещё ${group.matches.length - ROWS_PER_LEAGUE}`}
          <ChevronDown className={expanded ? "size-3.5 rotate-180" : "size-3.5"} />
        </button>
      ) : null}
    </section>
  );
}

/** Матчи популярных лиг вида спорта, сгруппированные по турнирам. */
export function ScheduleView({ sport }: { sport: SportId }) {
  const [day, setDay] = useState<ScheduleDay>("today");
  const [input, setInput] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const search = useDebouncedValue(input.trim().toLowerCase(), 250);
  const { data, isLoading, isError, error } = useSchedule(sport, day);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const m of data ?? []) {
      if (search) {
        const haystack = [
          m.home.name,
          m.away.name,
          m.league.name,
          m.league.display_name,
          m.league.country,
          m.league.display_country,
          ...m.players,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) continue;
      }
      const g = map.get(m.league.code) ?? {
        key: m.league.code,
        title: m.league.display_name ?? m.league.name,
        country: m.league.display_country ?? m.league.country,
        lines: 0,
        rank: m.league.featured_rank,
        matches: [],
      };
      g.matches.push(m);
      g.lines += m.lines;
      map.set(m.league.code, g);
    }
    // Лиги — в заданном порядке (featured_rank); турниры без порядка — по ближайшему матчу.
    return [...map.values()].sort(
      (a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.matches[0].starts_at.localeCompare(b.matches[0].starts_at),
    );
  }, [data, search]);

  const total = groups.reduce((s, g) => s + g.matches.length, 0);

  return (
    <div className="space-y-4">
      <ChipRow>
        {DAYS.map((d) => (
          <Chip
            key={d.value}
            active={day === d.value}
            onClick={() => {
              setDay(d.value);
              setLimit(PAGE);
            }}
          >
            {d.label}
          </Chip>
        ))}
      </ChipRow>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Команда, турнир, страна, игрок"
          className="pl-10"
          aria-label="Поиск по событиям"
          enterKeyHint="search"
        />
      </label>

      {isError ? (
        <p className="text-sm text-destructive">Не удалось загрузить события: {errorMessage(error)}</p>
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-48 rounded-3xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<CalendarX2 className="size-10" />} title="Матчей нет">
          {search ? "Попробуйте изменить запрос." : "В популярных лигах на этот период матчей нет."}
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {total} {plural(total, ["матч", "матча", "матчей"])} · {groups.length}{" "}
            {plural(groups.length, ["турнир", "турнира", "турниров"])}
          </p>
          <div className="space-y-3">
            {groups.slice(0, limit).map((g) => (
              <LeagueGroup key={g.key} group={g} />
            ))}
          </div>
          {groups.length > limit ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                Показать ещё турниры ({groups.length - limit})
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
