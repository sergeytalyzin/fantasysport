"use client";

import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { PickButton, usePickHandler } from "@/components/picks/board-view";
import { PlayerPhoto } from "@/components/sports/player-photo";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { MatchDetail } from "@/features/matches/hooks";
import { formatLine, plural } from "@/lib/format";
import { type PositionGroup, positionGroup } from "@/lib/positions";
import { cn } from "@/lib/utils";
import type { BoardProjection, TeamRef } from "@/types/domain";
import { TeamBadge } from "./team-badge";

interface PlayerEntry {
  player: BoardProjection["player"];
  group: PositionGroup;
  lines: BoardProjection[];
}

interface TeamSection {
  key: string;
  team: TeamRef | null;
  players: PlayerEntry[];
}

/** Спортсмены матча: по командам (хозяева, гости), внутри — по амплуа, затем по номеру и имени. */
function groupPlayers(match: MatchDetail, lines: BoardProjection[]): TeamSection[] {
  const byPlayer = new Map<string, PlayerEntry>();
  for (const l of lines) {
    const entry = byPlayer.get(l.player.id) ?? {
      player: l.player,
      group: positionGroup(match.league.sport_id, l.player.position),
      lines: [],
    };
    entry.lines.push(l);
    byPlayer.set(l.player.id, entry);
  }
  const sections: TeamSection[] = [
    { key: match.home.id, team: match.home, players: [] },
    { key: match.away.id, team: match.away, players: [] },
    // Источник линий не всегда знает команду спортсмена.
    { key: "unknown", team: null, players: [] },
  ];
  for (const entry of byPlayer.values()) {
    const section = sections.find((s) => s.team && s.team.id === entry.player.team?.id) ?? sections[2];
    section.players.push(entry);
  }
  for (const s of sections) {
    s.players.sort(
      (a, b) =>
        a.group.order - b.group.order ||
        (a.player.jersey_number ?? 999) - (b.player.jersey_number ?? 999) ||
        a.player.full_name.localeCompare(b.player.full_name, "ru"),
    );
  }
  return sections.filter((s) => s.players.length > 0);
}

function PlayerCard({ entry, picked, onOpen }: { entry: PlayerEntry; picked: boolean; onOpen: () => void }) {
  const { player, group, lines } = entry;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative flex w-full flex-col items-center overflow-hidden rounded-3xl border bg-surface-1 px-3 pb-3 pt-4 text-center transition-all hover:-translate-y-0.5",
        picked ? "border-primary/70 shadow-[0_0_0_1px_var(--primary)]" : "border-white/[0.07] hover:border-white/20",
      )}
      style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${group.color} 22%, transparent), var(--surface-1) 70%)` }}
    >
      <span
        className="absolute left-2.5 top-2.5 rounded-md px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-wide text-[#07090d]"
        style={{ background: group.color }}
      >
        {group.label}
      </span>
      {player.jersey_number ? (
        <span className="numeric absolute right-3 top-2.5 text-xs font-extrabold text-muted-foreground">#{player.jersey_number}</span>
      ) : null}
      <PlayerPhoto
        name={player.full_name}
        photoUrl={player.photo_url}
        credit={player}
        teamColor={group.color}
        number={player.jersey_number}
        className="mt-4 size-[4.5rem]"
      />
      <span className="mt-2.5 line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-tight">{player.full_name}</span>
      <span className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground group-hover:text-foreground">
        {lines.length} {plural(lines.length, ["линия", "линии", "линий"])}
        <ChevronRight className="size-3.5" />
      </span>
    </button>
  );
}

/** Линии одного спортсмена: только его статистика. */
function PlayerLines({ entry, onClose }: { entry: PlayerEntry | null; onClose: () => void }) {
  const { selected, onPick } = usePickHandler();
  return (
    <Sheet open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88dvh] max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl border-white/10 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5"
      >
        {entry ? (
          <>
            <SheetHeader className="flex-row items-center gap-3 p-0 text-left">
              <PlayerPhoto
                name={entry.player.full_name}
                photoUrl={entry.player.photo_url}
                credit={entry.player}
                showCredit
                teamColor={entry.group.color}
                number={entry.player.jersey_number}
                className="size-16"
              />
              <div className="min-w-0">
                <SheetTitle className="truncate font-display text-lg">{entry.player.full_name}</SheetTitle>
                <SheetDescription className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: entry.group.color }} />
                  {entry.group.label}
                  {entry.player.team ? ` · ${entry.player.team.name}` : ""}
                </SheetDescription>
              </div>
            </SheetHeader>
            <ul className="mt-4 space-y-2">
              {entry.lines.map((l) => (
                <li key={l.id} className="rounded-2xl border border-white/[0.07] bg-surface-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold">{l.market.name}</span>
                    <span className="numeric text-xl font-extrabold">{formatLine(l.line)}</span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                    <PickButton direction="UNDER" active={selected.get(l.id) === "UNDER"} onClick={() => onPick(l, "UNDER")} />
                    <PickButton direction="OVER" active={selected.get(l.id) === "OVER"} onClick={() => onPick(l, "OVER")} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-center text-xs text-muted-foreground">Один спортсмен — один прогноз в купоне.</p>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Карточки спортсменов матча; нажатие открывает линии спортсмена. */
export function MatchPlayers({ match, lines }: { match: MatchDetail; lines: BoardProjection[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { selected } = usePickHandler();
  const sections = useMemo(() => groupPlayers(match, lines), [match, lines]);
  const open = sections.flatMap((s) => s.players).find((p) => p.player.id === openId) ?? null;

  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <section key={s.key} aria-label={s.team?.name ?? "Игроки матча"}>
          <h2 className="mb-3 flex items-center gap-2.5 font-display text-base font-extrabold">
            {s.team ? <TeamBadge team={s.team} className="size-8 rounded-xl text-[0.55rem]" /> : null}
            {s.team?.name ?? "Игроки матча"}
            <span className="text-xs font-semibold text-muted-foreground">{s.players.length}</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {s.players.map((entry) => (
              <PlayerCard
                key={entry.player.id}
                entry={entry}
                picked={entry.lines.some((l) => selected.has(l.id))}
                onOpen={() => setOpenId(entry.player.id)}
              />
            ))}
          </div>
        </section>
      ))}
      <PlayerLines entry={open} onClose={() => setOpenId(null)} />
    </div>
  );
}
