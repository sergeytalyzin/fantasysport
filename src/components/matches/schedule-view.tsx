"use client";

import { CalendarX2, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { Chip, ChipRow } from "@/components/sports/chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ScheduleDay, type ScheduleItem, useSchedule, useSchedules } from "@/features/matches/hooks";
import { errorMessage } from "@/lib/errors";
import { HOME_SPORTS } from "@/lib/featured";
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
  /** Позиция вида спорта на главной. */
  sport: number;
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

/** Совпадает ли матч с поисковым запросом: команды, турнир, страна, спортсмены с линиями. */
function matchesSearch(m: ScheduleItem, search: string): boolean {
  return [m.home.name, m.away.name, m.league.name, m.league.display_name, m.league.country, m.league.display_country, ...m.players]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(search);
}

/** Группировка по турнирам: вид спорта (порядок главной), затем порядок лиги, затем ближайший матч. */
function groupByLeague(items: ScheduleItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const m of items) {
    const g = map.get(m.league.code) ?? {
      key: m.league.code,
      title: m.league.display_name ?? m.league.name,
      country: m.league.display_country ?? m.league.country,
      lines: 0,
      rank: m.league.featured_rank,
      sport: HOME_SPORTS.indexOf(m.league.sport_id),
      matches: [],
    };
    g.matches.push(m);
    g.lines += m.lines;
    map.set(m.league.code, g);
  }
  for (const g of map.values()) g.matches.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return [...map.values()].sort(
    (a, b) => a.sport - b.sport || (a.rank ?? 99) - (b.rank ?? 99) || a.matches[0].starts_at.localeCompare(b.matches[0].starts_at),
  );
}

/** Список турниров с матчами (общий для вкладок и поиска). */
function MatchGroups({
  items,
  isLoading,
  error,
  emptyTitle,
  emptyText,
}: {
  items: ScheduleItem[];
  isLoading: boolean;
  error: unknown;
  emptyTitle: string;
  emptyText: string;
}) {
  const [limit, setLimit] = useState(PAGE);
  const groups = useMemo(() => groupByLeague(items), [items]);
  const total = items.length;

  if (error) return <p className="text-sm text-destructive">Не удалось загрузить события: {errorMessage(error)}</p>;
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-3xl" />
        ))}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <EmptyState icon={<CalendarX2 className="size-10" />} title={emptyTitle}>
        {emptyText}
      </EmptyState>
    );
  }
  return (
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
  );
}

/** Матчи популярных лиг вида спорта за выбранный период. */
export function ScheduleView({ sport }: { sport: SportId }) {
  const [day, setDay] = useState<ScheduleDay>("today");
  const { data = [], isLoading, error } = useSchedule(sport, day);

  return (
    <div className="space-y-4">
      <ChipRow aria-label="Период">
        {DAYS.map((d) => (
          <Chip key={d.value} active={day === d.value} onClick={() => setDay(d.value)}>
            {d.label}
          </Chip>
        ))}
      </ChipRow>
      <MatchGroups
        key={day}
        items={data}
        isLoading={isLoading}
        error={error}
        emptyTitle="Матчей нет"
        emptyText="В популярных лигах на этот период матчей нет."
      />
    </div>
  );
}

/** Поиск по всей линии: все виды спорта главной, с начала сегодняшнего дня до конца послезавтра. */
export function ScheduleSearch({ search }: { search: string }) {
  const { data, isLoading, error } = useSchedules(HOME_SPORTS, "all");
  const items = useMemo(() => data.filter((m) => matchesSearch(m, search)), [data, search]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Результаты по всем видам спорта на сегодня и ближайшие дни</p>
      <MatchGroups
        key={search}
        items={items}
        isLoading={isLoading}
        error={error}
        emptyTitle="Ничего не найдено"
        emptyText="Попробуйте изменить запрос: команда, турнир, страна или игрок."
      />
    </div>
  );
}
