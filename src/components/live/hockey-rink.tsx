import type { LiveEvent } from "@/features/live/hooks";
import { cn } from "@/lib/utils";

/**
 * Хоккейная площадка в координатах NHL API (футы): x ∈ [-100, 100], y ∈ [-42.5, 42.5].
 * События уже нормализованы: хозяева атакуют вправо.
 */
export function HockeyRink({
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
  const lastId = plotted.at(-1)?.id;
  const line = "rgb(255 255 255 / 0.18)";
  return (
    <svg viewBox="-102 -44.5 204 89" className={cn("w-full", className)} role="img" aria-label="Карта бросков">
      <defs>
        <radialGradient id="ice" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#16202c" />
          <stop offset="100%" stopColor="#0c121a" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={-100} y={-42.5} width={200} height={85} rx={28} fill="url(#ice)" stroke="rgb(255 255 255 / 0.25)" strokeWidth={0.8} />
      {/* Синие линии, центральная красная и линии ворот */}
      <line x1={-25} y1={-42.5} x2={-25} y2={42.5} stroke="#3b82f6" strokeOpacity={0.5} strokeWidth={1.2} />
      <line x1={25} y1={-42.5} x2={25} y2={42.5} stroke="#3b82f6" strokeOpacity={0.5} strokeWidth={1.2} />
      <line x1={0} y1={-42.5} x2={0} y2={42.5} stroke="#ef4444" strokeOpacity={0.45} strokeWidth={1} />
      <line x1={-89} y1={-38} x2={-89} y2={38} stroke="#ef4444" strokeOpacity={0.35} strokeWidth={0.4} />
      <line x1={89} y1={-38} x2={89} y2={38} stroke="#ef4444" strokeOpacity={0.35} strokeWidth={0.4} />
      <circle cx={0} cy={0} r={15} fill="none" stroke={line} strokeWidth={0.5} />
      {[-69, 69].flatMap((x) =>
        [-22, 22].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={15} fill="none" stroke={line} strokeWidth={0.5} />),
      )}
      {/* Площади ворот и ворота */}
      <path d="M 89 -4 A 6 6 0 0 0 89 4" fill="rgb(59 130 246 / 0.25)" />
      <path d="M -89 -4 A 6 6 0 0 1 -89 4" fill="rgb(59 130 246 / 0.25)" />
      <rect x={-93} y={-3} width={4} height={6} fill="none" stroke="#ef4444" strokeOpacity={0.6} strokeWidth={0.6} />
      <rect x={89} y={-3} width={4} height={6} fill="none" stroke="#ef4444" strokeOpacity={0.6} strokeWidth={0.6} />

      {plotted.map((e) => {
        const color = e.side === "home" ? homeColor : awayColor;
        const cx = e.x!;
        const cy = -e.y!;
        if (e.kind === "goal") {
          return (
            <g key={e.id} filter="url(#glow)">
              {e.id === lastId ? <circle cx={cx} cy={cy} r={6} fill={color} opacity={0.35} className="animate-ping origin-center [transform-box:fill-box]" /> : null}
              <circle cx={cx} cy={cy} r={3.4} fill={color} stroke="white" strokeWidth={0.9}>
                <title>{`Гол: ${e.player ?? ""} (${e.label})`}</title>
              </circle>
            </g>
          );
        }
        return e.kind === "shot" ? (
          <circle key={e.id} cx={cx} cy={cy} r={1.7} fill={color} opacity={0.85}>
            <title>{`Бросок: ${e.player ?? ""} (${e.label})`}</title>
          </circle>
        ) : (
          <circle key={e.id} cx={cx} cy={cy} r={1.5} fill="none" stroke={color} strokeWidth={0.6} opacity={0.7}>
            <title>{`Мимо: ${e.player ?? ""} (${e.label})`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
