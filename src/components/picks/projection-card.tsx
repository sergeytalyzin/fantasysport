"use client";

import { ArrowDown, ArrowUp, Clock } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { DemoBadge } from "@/components/layout/demo-badge";
import { PlayerPhoto } from "@/components/sports/player-photo";
import { formatKickoff, formatKickoffShort, formatLine } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BoardProjection, PickDirection } from "@/types/domain";

interface ProjectionCardProps {
  projection: BoardProjection;
  selected: PickDirection | null;
  onPick: (projection: BoardProjection, direction: PickDirection) => void;
  /** Строка с матчем ведёт на страницу матча. */
  linkToMatch?: boolean;
}

function ProjectionCardBase({ projection, selected, onPick, linkToMatch = false }: ProjectionCardProps) {
  const { player, match, market } = projection;
  const team = player.team;
  const opponent = team?.id === match.home.id ? match.away : match.home;
  const isHome = team?.id === match.home.id;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border bg-surface-1 transition-all duration-200",
        selected === "OVER" && "border-over/70 shadow-[0_0_0_1px_var(--over),0_12px_32px_-12px_var(--over)]",
        selected === "UNDER" && "border-under/70 shadow-[0_0_0_1px_var(--under),0_12px_32px_-12px_var(--under)]",
        !selected && "border-white/[0.07] hover:border-white/15",
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-24 opacity-25"
        style={{ background: `linear-gradient(180deg, ${team?.color ?? "#7c8cff"}, transparent)` }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-2 px-3 pt-3 text-[0.68rem] font-semibold text-muted-foreground">
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-foreground">{match.league.short_name}</span>
        <time dateTime={match.starts_at} title={formatKickoff(match.starts_at)} className="flex items-center gap-1 truncate">
          <Clock className="size-3 shrink-0" />
          {formatKickoffShort(match.starts_at)}
        </time>
      </div>

      <div className="relative flex flex-col items-center px-3 pt-3 text-center">
        <div className="relative">
          <PlayerPhoto
            name={player.full_name}
            photoUrl={player.photo_url}
            teamColor={team?.color ?? null}
            number={player.jersey_number}
            className="size-[4.5rem]"
          />
          {match.source === "demo" ? <DemoBadge className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-background" /> : null}
        </div>
        <h3 className="mt-3 line-clamp-2 min-h-[2.5rem] font-sans text-[0.95rem] font-bold leading-tight tracking-normal">
          {player.full_name}
        </h3>
        {(() => {
          const label = (
            <>
              {team ? `${team.abbr} ${isHome ? "vs" : "@"} ${opponent.abbr}` : `${match.home.abbr} – ${match.away.abbr}`}
              {player.position ? ` · ${player.position}` : ""}
            </>
          );
          return linkToMatch ? (
            <Link
              href={`/matches/${match.id}`}
              className="mt-0.5 max-w-full truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              title="Все линии матча"
            >
              {label}
            </Link>
          ) : (
            <p className="mt-0.5 max-w-full truncate text-xs text-muted-foreground" title={player.position ?? undefined}>
              {label}
            </p>
          );
        })()}
      </div>

      <div className="relative mx-3 mt-3 flex flex-col items-center rounded-2xl bg-surface-2 py-2.5">
        <span className="numeric text-[1.65rem] font-extrabold leading-none">{formatLine(projection.line)}</span>
        <span className="mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">{market.name}</span>
      </div>

      <div className="relative grid grid-cols-2 gap-1.5 p-3">
        <PickButton direction="UNDER" active={selected === "UNDER"} onClick={() => onPick(projection, "UNDER")} />
        <PickButton direction="OVER" active={selected === "OVER"} onClick={() => onPick(projection, "OVER")} />
      </div>
    </article>
  );
}

function PickButton({ direction, active, onClick }: { direction: PickDirection; active: boolean; onClick: () => void }) {
  const over = direction === "OVER";
  const Icon = over ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-12 items-center justify-center gap-0.5 rounded-2xl text-[0.8rem] font-extrabold sm:gap-1 sm:text-sm transition-colors active:scale-95",
        active && "animate-pick-pop",
        over
          ? active
            ? "bg-over text-primary-foreground"
            : "bg-over/10 text-over hover:bg-over/20"
          : active
            ? "bg-under text-white"
            : "bg-under/10 text-under hover:bg-under/20",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={3} />
      {over ? "Больше" : "Меньше"}
    </button>
  );
}

export const ProjectionCard = memo(ProjectionCardBase);
