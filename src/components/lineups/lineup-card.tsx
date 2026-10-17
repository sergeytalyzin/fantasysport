import { ArrowDown, ArrowUp, Check, Circle, Minus, X } from "lucide-react";
import { PlayerPhoto } from "@/components/sports/player-photo";
import { formatDateTime, formatKickoff, formatLine, formatMultiplier, formatRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Lineup, LineupSelection } from "@/types/domain";
import { LineupStatusBadge, RESULT_STYLE } from "./lineup-status";

function ResultIcon({ result }: { result: LineupSelection["result"] }) {
  const base = "size-6 rounded-full p-1";
  if (result === "WIN") return <Check className={cn(base, "bg-over/15 text-over")} strokeWidth={3} />;
  if (result === "LOSS") return <X className={cn(base, "bg-under/15 text-under")} strokeWidth={3} />;
  if (result === "PENDING") return <Circle className={cn(base, "text-muted-foreground")} />;
  return <Minus className={cn(base, "bg-white/10 text-muted-foreground")} strokeWidth={3} />;
}

export function LineupCard({ lineup }: { lineup: Lineup }) {
  const settled = lineup.status !== "PENDING";
  const profit = settled ? (lineup.payout ?? 0) - lineup.stake : null;

  return (
    <article className="animate-rise overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
      <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <div>
          <p className="font-display text-sm font-bold">
            {lineup.play_type === "POWER" ? "Power Play" : "Flex Play"} · {lineup.picks_count} выб.
          </p>
          <p className="text-xs text-muted-foreground">{formatDateTime(lineup.created_at)}</p>
        </div>
        <LineupStatusBadge status={lineup.status} />
      </header>

      <ul className="divide-y divide-white/[0.05]">
        {lineup.selections.map((s) => {
          const over = s.direction === "OVER";
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <ResultIcon result={s.result} />
              <PlayerPhoto
                name={s.player_name}
                photoUrl={s.player?.photo_url ?? null}
                credit={s.player}
                teamColor={null}
                className="size-10 rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{s.player_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.league_code} · {s.team_abbr} vs {s.opponent_abbr} · {formatKickoff(s.match_starts_at)}
                </p>
              </div>
              <div className="text-right">
                <p className={cn("flex items-center justify-end gap-1 text-xs font-bold", over ? "text-over" : "text-under")}>
                  {over ? <ArrowUp className="size-3" strokeWidth={3} /> : <ArrowDown className="size-3" strokeWidth={3} />}
                  {over ? "Больше" : "Меньше"} <span className="numeric text-foreground">{formatLine(s.line)}</span>
                </p>
                <p className="text-[0.7rem] text-muted-foreground">{s.market_name}</p>
                {s.actual_value !== null || s.result !== "PENDING" ? (
                  <p className={cn("text-[0.7rem] font-semibold", RESULT_STYLE[s.result].className)}>
                    {s.actual_value !== null ? `Факт: ${formatLine(s.actual_value)}` : RESULT_STYLE[s.result].label}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="grid grid-cols-3 gap-2 border-t border-white/[0.06] bg-surface-2/60 px-4 py-3 text-xs">
        <div>
          <p className="text-muted-foreground">Сумма</p>
          <p className="numeric font-bold">{formatRub(lineup.stake)}</p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">Множитель</p>
          <p className="numeric font-bold">
            {formatMultiplier(settled && lineup.applied_multiplier !== null ? lineup.applied_multiplier : lineup.multiplier)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">{settled ? "Выплата" : "Возможная выплата"}</p>
          <p className={cn("numeric font-extrabold", settled ? (profit! > 0 ? "text-over" : profit! < 0 ? "text-under" : "") : "text-primary")}>
            {formatRub(settled ? (lineup.payout ?? 0) : lineup.potential_payout)}
          </p>
        </div>
        {lineup.settlement_note ? (
          <p className="col-span-3 text-[0.7rem] text-muted-foreground">{lineup.settlement_note}</p>
        ) : null}
      </footer>
    </article>
  );
}
