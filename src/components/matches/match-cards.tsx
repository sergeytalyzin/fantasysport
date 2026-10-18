import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { MatchListItem } from "@/features/matches/hooks";
import { formatDayShort, formatTime, plural } from "@/lib/format";
import { pairColors } from "@/lib/team-color";
import { TeamBadge } from "./team-badge";

const linesLabel = (n: number) => `${n} ${plural(n, ["линия", "линии", "линий"])}`;

/** Компактная строка матча в списке по дням. */
export function MatchRow({ match, showLeague = false }: { match: MatchListItem; showLeague?: boolean }) {
  const colors = pairColors(match.home, match.away);
  const live = match.status === "LIVE";
  const finished = match.status === "FINISHED";
  const day = live || finished ? "" : formatDayShort(match.starts_at);
  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.03] active:bg-white/[0.05] sm:px-4"
    >
      <div className="w-12 shrink-0 text-center">
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-under px-1.5 py-0.5 text-[0.65rem] font-extrabold uppercase text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> Live
          </span>
        ) : (
          <p className={finished ? "numeric text-sm font-bold text-muted-foreground line-through" : "numeric text-sm font-bold"}>
            {formatTime(match.starts_at)}
          </p>
        )}
        {day ? <p className="text-[0.6rem] font-semibold text-muted-foreground">{day}</p> : null}
        {showLeague ? <p className="truncate text-[0.65rem] font-semibold text-muted-foreground">{match.league.short_name}</p> : null}
        {finished ? <p className="text-[0.6rem] font-semibold text-muted-foreground">Завершён</p> : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {[match.home, match.away].map((team, i) => (
          <div key={team.id} className="flex min-w-0 items-center gap-2">
            <TeamBadge team={team} color={colors[i]} className="size-6 rounded-lg text-[0.5rem]" />
            <span className="truncate text-sm font-semibold">{team.name}</span>
          </div>
        ))}
      </div>
      {match.lines > 0 ? (
        <span className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-[0.7rem] font-bold text-primary">{linesLabel(match.lines)}</span>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
