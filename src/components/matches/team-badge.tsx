import { teamColor } from "@/lib/team-color";
import { cn } from "@/lib/utils";
import type { TeamRef } from "@/types/domain";

/** Эмблема команды: логотип, если есть, иначе аббревиатура на цвете команды. */
export function TeamBadge({ team, color: override, className }: { team: TeamRef; color?: string; className?: string }) {
  const color = override ?? teamColor(team);
  return (
    <span
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-display text-xs font-extrabold text-white shadow-lg",
        className,
      )}
      style={{ background: `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 45%, #07090d))` }}
      title={team.name}
    >
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- логотипы с внешних доменов провайдеров
        <img src={team.logo_url} alt={team.name} className="size-3/4 object-contain" />
      ) : (
        <span className="drop-shadow">{team.abbr}</span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
    </span>
  );
}
