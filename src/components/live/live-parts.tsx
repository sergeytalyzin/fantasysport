import { AlertTriangle, ArrowRightLeft, Disc, Goal, Target, Timer } from "lucide-react";
import { TeamBadge } from "@/components/matches/team-badge";
import type { LiveEvent, LiveSnapshot } from "@/features/live/hooks";
import { cn } from "@/lib/utils";
import type { TeamRef } from "@/types/domain";

export function LivePill({ state, className }: { state: LiveSnapshot["state"]; className?: string }) {
  if (state === "LIVE") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-under px-2.5 py-1 text-[0.7rem] font-extrabold uppercase tracking-wider text-white", className)}>
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-white" />
        </span>
        Live
      </span>
    );
  }
  const label = { PRE: "Скоро", BREAK: "Перерыв", FINAL: "Завершён" }[state];
  return <span className={cn("rounded-full bg-white/10 px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground", className)}>{label}</span>;
}

export function Scoreboard({
  snapshot,
  home,
  away,
  colors,
}: {
  snapshot: LiveSnapshot;
  home: TeamRef;
  away: TeamRef;
  colors: [string, string];
}) {
  const shotsTotal = (snapshot.home.shots ?? 0) + (snapshot.away.shots ?? 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamBadge team={home} color={colors[0]} className="size-14 sm:size-16" />
          <span className="text-sm font-bold leading-tight">{home.short_name}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <LivePill state={snapshot.state} />
          <p className="numeric text-5xl font-extrabold tabular-nums sm:text-6xl">
            {snapshot.home.score}
            <span className="mx-1.5 text-muted-foreground">:</span>
            {snapshot.away.score}
          </p>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            {snapshot.status}
            {snapshot.clock ? (
              <span className="numeric flex items-center gap-1 text-foreground">
                <Timer className="size-3.5" /> {snapshot.clock}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamBadge team={away} color={colors[1]} className="size-14 sm:size-16" />
          <span className="text-sm font-bold leading-tight">{away.short_name}</span>
        </div>
      </div>
      {shotsTotal > 0 ? (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-semibold text-muted-foreground">
            <span className="numeric text-foreground">{snapshot.home.shots}</span>
            <span>{snapshot.sport === "hockey" ? "Броски в створ" : "Удары"}</span>
            <span className="numeric text-foreground">{snapshot.away.shots}</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
            <div className="bg-primary transition-all duration-700" style={{ width: `${((snapshot.home.shots ?? 0) / shotsTotal) * 100}%` }} />
            <div className="flex-1 bg-white/30" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ICONS: Record<LiveEvent["kind"], { icon: typeof Goal; label: string; className: string }> = {
  goal: { icon: Goal, label: "Гол", className: "bg-primary text-primary-foreground" },
  shot: { icon: Target, label: "Бросок в створ", className: "bg-white/10 text-foreground" },
  miss: { icon: Disc, label: "Мимо", className: "bg-white/5 text-muted-foreground" },
  penalty: { icon: AlertTriangle, label: "Удаление", className: "bg-gold/15 text-gold" },
  card: { icon: AlertTriangle, label: "Жёлтая карточка", className: "bg-gold/20 text-gold" },
  "red-card": { icon: AlertTriangle, label: "Красная карточка", className: "bg-under/20 text-under" },
  sub: { icon: ArrowRightLeft, label: "Замена", className: "bg-white/10 text-muted-foreground" },
};

/** Лента событий, новые сверху. Броски/мимо скрыты, чтобы лента оставалась читаемой. */
export function EventFeed({ events, homeName, awayName }: { events: LiveEvent[]; homeName: string; awayName: string }) {
  const visible = events.filter((e) => !["shot", "miss"].includes(e.kind)).slice().reverse();
  if (visible.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">Ключевых событий пока нет</p>;
  }
  return (
    <ul className="divide-y divide-white/[0.05]">
      {visible.map((e, i) => {
        const meta = ICONS[e.kind];
        const Icon = meta.icon;
        return (
          <li key={e.id} className={cn("flex items-center gap-3 px-4 py-3", i === 0 && "animate-rise")}>
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", meta.className)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">
                {meta.label}
                {e.player ? <span className="font-semibold text-muted-foreground"> · {e.player}</span> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {e.side === "home" ? homeName : awayName}
                {e.detail ? ` · ${e.detail}` : ""}
              </p>
            </div>
            <span className="numeric shrink-0 text-xs font-semibold text-muted-foreground">{e.label.split(" · ").at(-1)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Leaders({ snapshot, homeName, awayName }: { snapshot: LiveSnapshot; homeName: string; awayName: string }) {
  return (
    <ul className="divide-y divide-white/[0.05]">
      {snapshot.leaders.map((l) => (
        <li key={l.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="min-w-0 truncate font-semibold">
            {l.name} <span className="text-xs font-normal text-muted-foreground">· {l.side === "home" ? homeName : awayName}</span>
          </span>
          <span className="numeric font-extrabold">
            {l.value} <span className="text-xs font-semibold text-muted-foreground">{l.stat}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
