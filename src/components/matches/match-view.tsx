"use client";

import { ArrowLeft, Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { PlayersGrid } from "@/components/picks/board-view";
import { BoardFilters, type BoardFilterState } from "@/components/sports/board-filters";
import { Chip, ChipRow } from "@/components/sports/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { useMatch } from "@/features/matches/hooks";
import { useBoard } from "@/features/projections/hooks";
import { formatCountdown, formatKickoff } from "@/lib/format";
import { pairColors } from "@/lib/team-color";
import { LiveCenter } from "@/components/live/live-center";
import { TeamBadge } from "./team-badge";

/** Обратный отсчёт обновляется раз в минуту. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function MatchView({ matchId }: { matchId: string }) {
  const { data: match, isLoading } = useMatch(matchId);
  const { data: lines = [], isLoading: linesLoading } = useBoard({ sport: null, league: null, matchId });
  const now = useNow();
  const [filters, setFilters] = useState<BoardFilterState>({ sport: null, league: null, market: null, search: "" });
  const [teamId, setTeamId] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-56 rounded-3xl" />;
  if (!match) {
    return (
      <EmptyState icon={<Clock className="size-10" />} title="Матч не найден">
        <Link href="/" className="font-semibold text-primary hover:underline">
          К списку матчей
        </Link>
      </EmptyState>
    );
  }

  const started = new Date(match.starts_at) <= now || match.status !== "SCHEDULED";
  if (started) {
    // Матч идёт или завершён: вместо линий — онлайн-трансляция.
    return (
      <div className="space-y-5">
        <Link href="/" className="-my-3 inline-flex items-center gap-1.5 py-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Все матчи
        </Link>
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-foreground">{match.league.short_name}</span>
          <span>{formatKickoff(match.starts_at, now)}</span>
        </div>
        <LiveCenter match={match} />
      </div>
    );
  }

  const [home, away] = pairColors(match.home, match.away);
  // Фильтр по команде имеет смысл, только если провайдер знает команды спортсменов.
  const teamsKnown = lines.some((l) => l.player.team);

  return (
    <div className="space-y-5">
      <Link href="/" className="-my-3 inline-flex items-center gap-1.5 py-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Все матчи
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-surface-1 p-5 sm:p-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{ background: `linear-gradient(110deg, ${home} 0%, transparent 42%, transparent 58%, ${away} 100%)` }}
          aria-hidden
        />
        <div className="relative flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-foreground">{match.league.short_name}</span>
        </div>
        <div className="relative mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <TeamBadge team={match.home} color={home} className="size-16 text-sm sm:size-20" />
            <span className="font-display text-sm font-bold leading-tight sm:text-lg">{match.home.name}</span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Хозяева</span>
          </div>
          <div className="text-center">
            <p className="font-display text-xl font-extrabold text-muted-foreground">VS</p>
          </div>
          <div className="flex flex-col items-center gap-2.5 text-center">
            <TeamBadge team={match.away} color={away} className="size-16 text-sm sm:size-20" />
            <span className="font-display text-sm font-bold leading-tight sm:text-lg">{match.away.name}</span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Гости</span>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="flex items-center gap-1.5 rounded-xl bg-black/25 px-3 py-1.5 font-semibold">
            <Clock className="size-4 text-primary" /> {formatKickoff(match.starts_at, now)}
          </span>
          <span className="rounded-xl bg-primary/15 px-3 py-1.5 font-bold text-primary">{formatCountdown(match.starts_at, now)}</span>
        </div>
      </section>

      {!linesLoading && lines.length === 0 ? (
        <EmptyState icon={<Clock className="size-10" />} title="Линий на этот матч нет">
          Букмекеры не выставили линии на игроков этого матча. Расписание и результаты — реальные данные из API.
        </EmptyState>
      ) : (
      <>
          <BoardFilters
            value={{ ...filters, sport: match.league.sport_id }}
            onChange={setFilters}
            show={{ sports: false, markets: true, search: true }}
          />
          {teamsKnown ? (
            <ChipRow>
              <Chip active={!teamId} onClick={() => setTeamId(null)} className="h-8 text-xs">
                Обе команды
              </Chip>
              {[match.home, match.away].map((t) => (
                <Chip key={t.id} active={teamId === t.id} onClick={() => setTeamId(t.id)} className="h-8 text-xs">
                  {t.short_name}
                </Chip>
              ))}
            </ChipRow>
          ) : null}
          <PlayersGrid matchId={matchId} market={filters.market} search={filters.search} teamId={teamId} />
      </>
      )}
    </div>
  );
}
