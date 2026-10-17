import { ChevronRight, Flame } from "lucide-react";
import Link from "next/link";
import { DemoBadge } from "@/components/layout/demo-badge";
import type { MatchListItem } from "@/features/matches/hooks";
import { formatKickoff, formatTime, plural } from "@/lib/format";
import { pairColors } from "@/lib/team-color";
import { TeamBadge } from "./team-badge";

const linesLabel = (n: number) => `${n} ${plural(n, ["линия", "линии", "линий"])}`;

/** Крупная карточка «главного события». */
export function TopMatchCard({ match }: { match: MatchListItem }) {
  const [home, away] = pairColors(match.home, match.away);
  return (
    <Link
      href={`/matches/${match.id}`}
      className="group relative flex w-[17.5rem] shrink-0 flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-surface-1 p-4 transition-all hover:-translate-y-0.5 hover:border-white/20 sm:w-auto"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{ background: `linear-gradient(110deg, ${home} 0%, transparent 45%, transparent 55%, ${away} 100%)` }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between text-[0.7rem] font-semibold text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-foreground">{match.league.short_name}</span>
          {match.source === "demo" ? <DemoBadge /> : null}
        </span>
        <span>{formatKickoff(match.starts_at)}</span>
      </div>

      <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamBadge team={match.home} color={home} className="size-14" />
          <span className="line-clamp-2 text-sm font-bold leading-tight">{match.home.short_name}</span>
        </div>
        <span className="font-display text-sm font-bold text-muted-foreground">VS</span>
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamBadge team={match.away} color={away} className="size-14" />
          <span className="line-clamp-2 text-sm font-bold leading-tight">{match.away.short_name}</span>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between rounded-2xl bg-black/25 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-primary">
          <Flame className="size-3.5" /> {linesLabel(match.lines)}
        </span>
        <span className="flex items-center gap-0.5 text-xs font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
          Выбрать игроков <ChevronRight className="size-3.5" />
        </span>
      </div>
    </Link>
  );
}

/** Компактная строка матча в списке по дням. */
export function MatchRow({ match }: { match: MatchListItem }) {
  const colors = pairColors(match.home, match.away);
  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-white/[0.03] sm:px-4"
    >
      <div className="w-12 shrink-0 text-center">
        <p className="numeric text-sm font-bold">{formatTime(match.starts_at)}</p>
        <p className="text-[0.65rem] font-semibold text-muted-foreground">{match.league.short_name}</p>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {[match.home, match.away].map((team, i) => (
          <div key={team.id} className="flex items-center gap-2">
            <TeamBadge team={team} color={colors[i]} className="size-6 rounded-lg text-[0.5rem]" />
            <span className="truncate text-sm font-semibold">{team.name}</span>
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {match.source === "demo" ? <DemoBadge /> : null}
        <span className="rounded-lg bg-primary/10 px-2 py-1 text-[0.7rem] font-bold text-primary">{linesLabel(match.lines)}</span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
