"use client";

import { ArrowLeft, Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useMatch } from "@/features/matches/hooks";
import { useBoard } from "@/features/projections/hooks";
import { formatCountdown, formatKickoff } from "@/lib/format";
import { pairColors } from "@/lib/team-color";
import { LiveCenter } from "@/components/live/live-center";
import { MatchPlayers } from "./match-players";
import { MatchStream } from "./match-stream";
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
        <MatchStream url={match.stream_url} title={`${match.home.name} — ${match.away.name}`} />
        <LiveCenter match={match} />
      </div>
    );
  }

  const [home, away] = pairColors(match.home, match.away);

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

      <MatchStream url={match.stream_url} title={`${match.home.name} — ${match.away.name}`} />

      {!linesLoading && lines.length === 0 ? (
        <EmptyState icon={<Clock className="size-10" />} title="Линий на этот матч нет">
          Букмекеры не выставили линии на игроков этого матча. Расписание и результаты — реальные данные из API.
        </EmptyState>
      ) : linesLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-3xl" />
          ))}
        </div>
      ) : (
        <MatchPlayers match={match} lines={lines} />
      )}
    </div>
  );
}
