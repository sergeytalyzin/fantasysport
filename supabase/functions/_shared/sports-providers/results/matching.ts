// Сопоставление команд и спортсменов между провайдерами.
// Разные источники пишут имена по-разному: «Cunningham, Cade», «F. Svechkov»,
// «Nikita Kučerov». Сопоставление консервативное: при неоднозначности игрок
// считается несопоставленным, и матч не подтверждается автоматически.

/** «Nikita Kučerov» → «nikita kucerov»; «Cunningham, Cade» → «cade cunningham». */
export function normalizeName(name: string): string {
  const parts = name.split(",").map((p) => p.trim());
  const ordered = parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : name;
  return ordered
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-zа-яё\s-]/gu, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ключ «инициал + фамилия»: «Alexander Ovechkin» и «A. Ovechkin» → «a ovechkin». */
export function initialKey(name: string): string | null {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  return `${tokens[0][0]} ${tokens.slice(1).join(" ")}`;
}

function lastName(name: string): string | null {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1] : null;
}

export interface NamedPlayer {
  /** Полное имя, если провайдер его отдаёт. */
  fullName: string;
}

export interface PlayerMatchResult<T> {
  matched: Map<string, T>;
  unmatched: { player_id: string; full_name: string }[];
}

/**
 * Для каждого нашего спортсмена ищет ровно одного кандидата у провайдера:
 * 1) полное имя; 2) инициал + фамилия; 3) уникальная фамилия.
 * На каждом шаге совпадение должно быть единственным с обеих сторон.
 */
export function matchPlayers<T extends NamedPlayer>(
  ours: { player_id: string; full_name: string }[],
  theirs: T[],
): PlayerMatchResult<T> {
  const matched = new Map<string, T>();
  const used = new Set<T>();
  const strategies: ((name: string) => string | null)[] = [normalizeName, initialKey, lastName];

  let pending = [...ours];
  for (const key of strategies) {
    const index = new Map<string, T[]>();
    for (const t of theirs) {
      if (used.has(t)) continue;
      const k = key(t.fullName);
      if (k) index.set(k, [...(index.get(k) ?? []), t]);
    }
    const ourCounts = new Map<string, number>();
    for (const o of pending) {
      const k = key(o.full_name);
      if (k) ourCounts.set(k, (ourCounts.get(k) ?? 0) + 1);
    }
    const next: typeof pending = [];
    for (const o of pending) {
      const k = key(o.full_name);
      const candidates = k ? index.get(k) : undefined;
      if (k && candidates?.length === 1 && ourCounts.get(k) === 1) {
        matched.set(o.player_id, candidates[0]);
        used.add(candidates[0]);
      } else {
        next.push(o);
      }
    }
    pending = next;
  }
  return { matched, unmatched: pending };
}

export interface TeamNames {
  name: string;
  short_name?: string | null;
  abbr?: string | null;
}

const STOP_WORDS = new Set(["fc", "fk", "cf", "afc", "sc", "the", "club", "hc", "hk"]);

function tokens(value: string): Set<string> {
  return new Set(
    normalizeName(value)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
  );
}

/**
 * Совпадение команды: одинаковая аббревиатура или общий значимый токен названия
 * («Colorado Avalanche» ~ «Avalanche», «Manchester City» ~ «Man City» — нет,
 * поэтому сравниваются все варианты названий с обеих сторон).
 */
export function teamMatches(ours: TeamNames, theirs: { names: string[]; abbr?: string | null }): boolean {
  if (ours.abbr && theirs.abbr && normalizeName(ours.abbr) === normalizeName(theirs.abbr)) return true;
  const ourNames = [ours.name, ours.short_name].filter(Boolean) as string[];
  for (const a of ourNames) {
    for (const b of theirs.names) {
      if (normalizeName(a) === normalizeName(b)) return true;
      const ta = tokens(a);
      const tb = tokens(b);
      // Все значимые слова одного названия содержатся в другом.
      const contained = (x: Set<string>, y: Set<string>) => x.size > 0 && [...x].every((t) => y.has(t));
      if (contained(ta, tb) || contained(tb, ta)) return true;
    }
  }
  return false;
}
