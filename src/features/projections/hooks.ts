"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BoardProjection } from "@/types/domain";

const TEAM = "id, name, short_name, abbr, color, logo_url";

// Одна выборка со всеми связями — без N+1.
const BOARD_SELECT = `
  id, line, status, line_updated_at,
  market:markets!inner(id, code, name, short_name),
  player:players!inner(id, full_name, position, jersey_number, photo_url, photo_source, photo_license, photo_author,
    photo_page_url, team:teams(${TEAM})),
  match:matches!inner(
    id, starts_at, status, source,
    league:leagues!inner(code, short_name, sport_id),
    home:teams!matches_home_team_id_fkey(${TEAM}),
    away:teams!matches_away_team_id_fkey(${TEAM})
  )
`;

export interface BoardFilters {
  sport: string | null;
  league: string | null;
  matchId?: string | null;
}

export async function fetchBoard({ sport, league, matchId }: BoardFilters): Promise<BoardProjection[]> {
  let query = getSupabaseBrowserClient()
    .from("projections")
    .select(BOARD_SELECT)
    .eq("status", "OPEN")
    .eq("match.status", "SCHEDULED")
    .gt("match.starts_at", new Date().toISOString())
    .limit(1000);
  if (sport) query = query.eq("match.league.sport_id", sport);
  if (league) query = query.eq("match.league.code", league);
  if (matchId) query = query.eq("match_id", matchId);

  const rows = unwrap(await query) as unknown as BoardProjection[];
  return rows
    .map((r) => ({ ...r, line: Number(r.line) }))
    .sort(
      (a, b) =>
        a.match.starts_at.localeCompare(b.match.starts_at) ||
        a.match.id.localeCompare(b.match.id) ||
        a.player.full_name.localeCompare(b.player.full_name, "ru"),
    );
}

export function useBoard(filters: BoardFilters) {
  return useQuery({
    queryKey: queryKeys.board(filters),
    queryFn: () => fetchBoard(filters),
    // Линии обновляются фоновой синхронизацией каждые 15 минут.
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
}
