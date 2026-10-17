"use client";

import Link from "next/link";
import { LivePill } from "@/components/live/live-parts";
import { useLiveMatch } from "@/features/live/hooks";
import type { MatchListItem } from "@/features/matches/hooks";
import { pairColors } from "@/lib/team-color";
import { TeamBadge } from "./team-badge";

/** Карточка идущего матча со счётом из live-снимка (кэшируется на сервере). */
export function LiveMatchCard({ match }: { match: Omit<MatchListItem, "lines"> }) {
  const { data } = useLiveMatch(match.id);
  const s = data?.snapshot;
  const [homeColor, awayColor] = pairColors(match.home, match.away);
  return (
    <Link
      href={`/matches/${match.id}`}
      className="relative flex w-[16rem] shrink-0 flex-col gap-3 overflow-hidden rounded-3xl border border-under/30 bg-surface-1 p-4 transition-colors hover:border-under/60"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{ background: `linear-gradient(110deg, ${homeColor}, transparent 45%, transparent 55%, ${awayColor})` }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between text-[0.7rem] font-semibold text-muted-foreground">
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-foreground">{match.league.short_name}</span>
        {s ? <LivePill state={s.state} /> : <LivePill state="LIVE" />}
      </div>
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <TeamBadge team={match.home} color={homeColor} className="size-10" />
          <span className="line-clamp-1 text-xs font-bold">{match.home.short_name}</span>
        </div>
        <span className="numeric text-2xl font-extrabold">{s ? `${s.home.score}:${s.away.score}` : "–:–"}</span>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <TeamBadge team={match.away} color={awayColor} className="size-10" />
          <span className="line-clamp-1 text-xs font-bold">{match.away.short_name}</span>
        </div>
      </div>
      <p className="relative text-center text-xs font-semibold text-muted-foreground">
        {s ? `${s.status}${s.clock ? ` · ${s.clock}` : ""}` : "Онлайн"}
      </p>
    </Link>
  );
}
