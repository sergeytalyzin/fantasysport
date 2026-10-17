import { cn } from "@/lib/utils";
import type { LineupStatus, SelectionResult } from "@/types/domain";

const STATUS: Record<LineupStatus, { label: string; className: string }> = {
  PENDING: { label: "В игре", className: "bg-primary/15 text-primary" },
  WON: { label: "Выигрыш", className: "bg-over/15 text-over" },
  PARTIALLY_WON: { label: "Частичный выигрыш", className: "bg-gold/15 text-gold" },
  LOST: { label: "Проигрыш", className: "bg-under/15 text-under" },
  VOID: { label: "Аннулирован", className: "bg-white/10 text-muted-foreground" },
  REFUNDED: { label: "Возврат", className: "bg-white/10 text-muted-foreground" },
};

export function LineupStatusBadge({ status }: { status: LineupStatus }) {
  const s = STATUS[status];
  return <span className={cn("rounded-lg px-2 py-1 text-xs font-bold", s.className)}>{s.label}</span>;
}

export const RESULT_STYLE: Record<SelectionResult, { label: string; className: string }> = {
  PENDING: { label: "Ожидание", className: "text-muted-foreground" },
  WIN: { label: "Сыграл", className: "text-over" },
  LOSS: { label: "Не сыграл", className: "text-under" },
  PUSH: { label: "Равенство", className: "text-muted-foreground" },
  VOID: { label: "Аннулирован", className: "text-muted-foreground" },
};
