"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MatchStatus, SportId, TeamRef } from "@/types/domain";

export interface MatchListItem {
  id: string;
  starts_at: string;
  status: MatchStatus;
  source: string;
  league: { code: string; short_name: string; sport_id: SportId };
  home: TeamRef;
  away: TeamRef;
  /** Число открытых линий. */
  lines: number;
}

const TEAM = "id, name, short_name, abbr, color, logo_url";
const MATCH_SELECT = `id, starts_at, status, source,
  league:leagues!inner(code, short_name, sport_id),
  home:teams!matches_home_team_id_fkey(${TEAM}),
  away:teams!matches_away_team_id_fkey(${TEAM})`;

type Row = Omit<MatchListItem, "lines"> & { projections?: { count: number }[] };

/** Предстоящие матчи с открытыми линиями — один запрос, количество линий считает PostgREST. */
export function useMatches({ sport, league }: { sport: string | null; league: string | null }) {
  return useQuery({
    queryKey: ["matches", { sport, league }],
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      let query = getSupabaseBrowserClient()
        .from("matches")
        .select(`${MATCH_SELECT}, projections!inner(count)`)
        .eq("status", "SCHEDULED")
        .gt("starts_at", new Date().toISOString())
        .eq("projections.status", "OPEN")
        .order("starts_at")
        .limit(200);
      if (sport) query = query.eq("league.sport_id", sport);
      if (league) query = query.eq("league.code", league);
      const rows = unwrap(await query) as unknown as Row[];
      // Агрегат с !inner может вернуть матч с нулём открытых линий — такие скрываем.
      return rows
        .map(({ projections, ...m }) => ({ ...m, lines: projections?.[0]?.count ?? 0 }))
        .filter((m) => m.lines > 0) as MatchListItem[];
    },
  });
}

export function useMatch(id: string) {
  return useQuery({
    queryKey: ["match", id],
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap(await getSupabaseBrowserClient().from("matches").select(MATCH_SELECT).eq("id", id).maybeSingle()) as unknown as Omit<
        MatchListItem,
        "lines"
      > | null,
  });
}

/**
 * «Главные события»: реальные данные выше демо, затем больше линий, затем раньше начало.
 * Статистики популярности пока нет — это честный порядок по доступным данным.
 */
export function topMatches(matches: MatchListItem[], count = 6): MatchListItem[] {
  return [...matches]
    .sort(
      (a, b) =>
        Number(a.source === "demo") - Number(b.source === "demo") ||
        b.lines - a.lines ||
        a.starts_at.localeCompare(b.starts_at),
    )
    .slice(0, count);
}

/** Матчи, которые идут сейчас (по времени начала) и ещё не подтверждены. */
export function useLiveMatches({ sport, league }: { sport: string | null; league: string | null }) {
  return useQuery({
    queryKey: ["matches-live", { sport, league }],
    refetchInterval: 60_000,
    queryFn: async () => {
      const now = Date.now();
      let query = getSupabaseBrowserClient()
        .from("matches")
        .select(MATCH_SELECT)
        .lte("starts_at", new Date(now).toISOString())
        .gt("starts_at", new Date(now - 4 * 3600_000).toISOString())
        .is("results_confirmed_at", null)
        .neq("status", "CANCELLED")
        .order("starts_at", { ascending: false })
        .limit(10);
      if (sport) query = query.eq("league.sport_id", sport);
      if (league) query = query.eq("league.code", league);
      return unwrap(await query) as unknown as Omit<MatchListItem, "lines">[];
    },
  });
}
