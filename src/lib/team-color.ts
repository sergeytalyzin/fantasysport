// Цвет команды: из БД, а если провайдер его не дал (OddsPapi) — стабильный
// цвет из палитры по названию, чтобы одна команда всегда выглядела одинаково.

const PALETTE = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1"];

export function teamColor(team: { color: string | null; name: string; abbr?: string | null }): string {
  if (team.color) return team.color;
  const seed = team.abbr || team.name;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Цвета пары соперников: если совпали, гости получают другой цвет палитры. */
export function pairColors(
  home: { color: string | null; name: string; abbr?: string | null },
  away: { color: string | null; name: string; abbr?: string | null },
): [string, string] {
  const h = teamColor(home);
  let a = teamColor(away);
  if (a.toLowerCase() === h.toLowerCase()) {
    a = PALETTE[(PALETTE.indexOf(a) + 5) % PALETTE.length] ?? "#f59e0b";
    if (a.toLowerCase() === h.toLowerCase()) a = "#f59e0b";
  }
  return [h, a];
}
