import { Crown } from "lucide-react";
import { UserAvatar } from "@/components/layout/user-avatar";
import { formatPercent, formatRub, formatRubCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthlyLeaderboardRow, OverallLeaderboardRow } from "@/types/domain";

const MEDAL: Record<number, string> = { 1: "text-gold", 2: "text-silver", 3: "text-bronze" };

export function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "numeric flex w-9 shrink-0 items-center justify-center text-sm font-extrabold",
        MEDAL[rank] ?? "text-muted-foreground",
      )}
    >
      {rank <= 3 ? <Crown className="mr-0.5 size-3.5" /> : null}
      {rank}
    </span>
  );
}

function Row({
  rank,
  nickname,
  avatarUrl,
  primary,
  primaryClass,
  secondary,
  highlight,
}: {
  rank: number;
  nickname: string;
  avatarUrl: string | null;
  primary: string;
  primaryClass?: string;
  secondary: string;
  highlight: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 sm:px-4",
        highlight && "bg-primary/10",
        rank <= 3 && "bg-gradient-to-r from-white/[0.03] to-transparent",
      )}
    >
      <RankBadge rank={rank} />
      <UserAvatar nickname={nickname} url={avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          {nickname}
          {highlight ? <span className="ml-1.5 text-xs font-semibold text-primary">это вы</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      <p className={cn("numeric text-right text-sm font-extrabold", primaryClass)}>{primary}</p>
    </li>
  );
}

const profitClass = (v: number) => (v > 0 ? "text-over" : v < 0 ? "text-under" : "text-muted-foreground");

export function OverallRows({ rows, meId }: { rows: OverallLeaderboardRow[]; meId: string | null }) {
  return (
    <ul className="divide-y divide-white/[0.05]">
      {rows.map((r) => (
        <Row
          key={r.user_id}
          rank={r.rank}
          nickname={r.nickname}
          avatarUrl={r.avatar_url}
          primary={formatRubCompact(r.capital)}
          secondary={`Прибыль ${formatRub(r.profit, { sign: true })} · ${r.lineups_total} прогн. · ${formatPercent(r.win_rate)}`}
          highlight={r.user_id === meId}
        />
      ))}
    </ul>
  );
}

export function MonthlyRows({ rows, meId }: { rows: MonthlyLeaderboardRow[]; meId: string | null }) {
  return (
    <ul className="divide-y divide-white/[0.05]">
      {rows.map((r) => (
        <Row
          key={r.user_id}
          rank={r.rank}
          nickname={r.nickname}
          avatarUrl={r.avatar_url}
          primary={formatRub(r.profit, { sign: true })}
          primaryClass={profitClass(r.profit)}
          secondary={`${r.lineups_settled} рассчитано · ${r.lineups_won} выигрышных`}
          highlight={r.user_id === meId}
        />
      ))}
    </ul>
  );
}
