import type { LiveEvent } from "@/features/live/hooks";
import { cn } from "@/lib/utils";

/** Футбольное поле 105 × 68 м. События с координатами (демо) — точками; хозяева атакуют вправо. */
export function FootballPitch({
  events,
  homeColor,
  awayColor,
  className,
}: {
  events: LiveEvent[];
  homeColor: string;
  awayColor: string;
  className?: string;
}) {
  const plotted = events.filter((e) => e.x != null && e.y != null && ["goal", "shot", "miss"].includes(e.kind));
  const line = "rgb(255 255 255 / 0.35)";
  return (
    <svg viewBox="-2 -2 109 72" className={cn("w-full", className)} role="img" aria-label="Схема поля">
      <defs>
        <pattern id="grass" width="21" height="68" patternUnits="userSpaceOnUse">
          <rect width="10.5" height="68" fill="#0f2a1c" />
          <rect x="10.5" width="10.5" height="68" fill="#123222" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={105} height={68} rx={2} fill="url(#grass)" stroke={line} strokeWidth={0.4} />
      <line x1={52.5} y1={0} x2={52.5} y2={68} stroke={line} strokeWidth={0.3} />
      <circle cx={52.5} cy={34} r={9.15} fill="none" stroke={line} strokeWidth={0.3} />
      <circle cx={52.5} cy={34} r={0.5} fill={line} />
      {[0, 105].map((x) => {
        const dir = x === 0 ? 1 : -1;
        return (
          <g key={x}>
            <rect x={x === 0 ? 0 : 105 - 16.5} y={13.85} width={16.5} height={40.3} fill="none" stroke={line} strokeWidth={0.3} />
            <rect x={x === 0 ? 0 : 105 - 5.5} y={24.85} width={5.5} height={18.3} fill="none" stroke={line} strokeWidth={0.3} />
            <rect x={x === 0 ? -1.5 : 105} y={30.34} width={1.5} height={7.32} fill="rgb(255 255 255 / 0.5)" />
            <circle cx={x + dir * 11} cy={34} r={0.45} fill={line} />
          </g>
        );
      })}
      {plotted.map((e) => {
        const color = e.side === "home" ? homeColor : awayColor;
        if (e.kind === "goal") {
          return (
            <circle key={e.id} cx={e.x!} cy={e.y!} r={1.9} fill={color} stroke="white" strokeWidth={0.5}>
              <title>{`Гол: ${e.player ?? ""} (${e.label})`}</title>
            </circle>
          );
        }
        return e.kind === "shot" ? (
          <circle key={e.id} cx={e.x!} cy={e.y!} r={0.95} fill={color} opacity={0.9}>
            <title>{`Удар в створ: ${e.player ?? ""} (${e.label})`}</title>
          </circle>
        ) : (
          <circle key={e.id} cx={e.x!} cy={e.y!} r={0.85} fill="none" stroke={color} strokeWidth={0.35} opacity={0.8}>
            <title>{`Мимо: ${e.player ?? ""} (${e.label})`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

/** Таймлайн 0–90': голы и карточки хозяев сверху, гостей снизу. */
export function MatchTimeline({
  events,
  minute,
  homeColor,
  awayColor,
}: {
  events: LiveEvent[];
  minute: number;
  homeColor: string;
  awayColor: string;
}) {
  const key = events.filter((e) => ["goal", "card", "red-card"].includes(e.kind));
  const pos = (label: string) => Math.min(100, (parseInt(label, 10) / 90) * 100);
  const icon = (e: LiveEvent) => (e.kind === "goal" ? "⚽" : e.kind === "red-card" ? "🟥" : "🟨");
  return (
    <div className="relative mx-2 h-16" aria-label="Таймлайн матча">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
      <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/70" style={{ width: `${Math.min(100, (minute / 90) * 100)}%` }} />
      <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-y-1/2 bg-white/30" />
      {key.map((e) => (
        <span
          key={e.id}
          title={`${e.label} ${e.player ?? ""}`}
          className="absolute -translate-x-1/2 text-sm leading-none"
          style={{ left: `${pos(e.label)}%`, top: e.side === "home" ? 0 : undefined, bottom: e.side === "away" ? 0 : undefined }}
        >
          <span className="block rounded-full p-0.5" style={{ boxShadow: `0 0 0 1.5px ${e.side === "home" ? homeColor : awayColor}` }}>
            {icon(e)}
          </span>
        </span>
      ))}
      <span className="absolute -bottom-4 left-0 text-[0.6rem] text-muted-foreground">0&apos;</span>
      <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[0.6rem] text-muted-foreground">45&apos;</span>
      <span className="absolute -bottom-4 right-0 text-[0.6rem] text-muted-foreground">90&apos;</span>
    </div>
  );
}
