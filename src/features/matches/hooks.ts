"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ESPORTS_SPORTS, FEATURED_ESPORTS_PATTERN } from "@/lib/featured";
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

export type MatchDetail = Omit<MatchListItem, "lines"> & { stream_url: string | null };

export function useMatch(id: string) {
  return useQuery({
    queryKey: ["match", id],
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowserClient().from("matches").select(`${MATCH_SELECT}, stream_url`).eq("id", id).maybeSingle(),
      ) as unknown as MatchDetail | null,
  });
}

/**
 * «today»/«tomorrow» — московские сутки; «upcoming» и «all» (поиск) — сегодня и два следующих дня.
 * Во всех случаях — только ещё не начавшиеся матчи.
 */
export type ScheduleDay = "today" | "tomorrow" | "upcoming" | "all";

export interface ScheduleItem extends MatchListItem {
  league: MatchListItem["league"] & {
    name: string;
    country: string | null;
    sort_order: number;
    featured_rank: number | null;
    /** Подпись популярной лиги на главной (если задана). */
    display_name: string | null;
    display_country: string | null;
  };
  /** Спортсмены с открытыми линиями — для поиска по игроку. */
  players: string[];
}

const MSK_MS = 3 * 3600_000;
const SCHEDULE_PAGE = 1000;
const SCHEDULE_MAX = 10_000;

/** Границы московских суток (UTC) со смещением в днях. */
function mskDayRange(offsetDays: number): [string, string] {
  const now = Date.now() + MSK_MS;
  const start = Math.floor(now / 86_400_000) * 86_400_000 + offsetDays * 86_400_000 - MSK_MS;
  return [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()];
}

type ScheduleRow = Omit<ScheduleItem, "lines" | "players"> & { projections?: { id: string; player: { full_name: string } | null }[] };

/**
 * Матчи популярных лиг вида спорта (см. src/lib/featured.ts) с числом открытых линий
 * и именами спортсменов, на которых они выставлены.
 */
export function useSchedule(sport: SportId, day: ScheduleDay) {
  return useQuery(scheduleQuery(sport, day));
}

/** Матчи популярных лиг нескольких видов спорта (поиск по всей линии). */
export function useSchedules(sports: SportId[], day: ScheduleDay, enabled = true) {
  return useQueries({
    queries: sports.map((sport) => ({ ...scheduleQuery(sport, day), enabled })),
    combine: (results) => ({
      data: results.flatMap((r) => r.data ?? []),
      isLoading: results.some((r) => r.isLoading),
      error: results.find((r) => r.error)?.error ?? null,
    }),
  });
}

function scheduleQuery(sport: SportId, day: ScheduleDay) {
  return {
    queryKey: ["schedule", sport, day],
    refetchInterval: 120_000,
    placeholderData: (previous: ScheduleItem[] | undefined) => previous,
    queryFn: async (): Promise<ScheduleItem[]> => {
      const page = async (offset: number) => {
        let query = getSupabaseBrowserClient()
          .from("matches")
          .select(
            `id, starts_at, status, source,
             league:leagues!inner(code, short_name, sport_id, name, country, sort_order, featured_rank, display_name, display_country),
             home:teams!matches_home_team_id_fkey(${TEAM}),
             away:teams!matches_away_team_id_fkey(${TEAM}),
             projections(id, player:players(full_name))`,
          )
          .eq("league.sport_id", sport)
          .eq("projections.status", "OPEN")
          .neq("status", "CANCELLED")
          .order("starts_at")
          .order("id")
          .range(offset, offset + SCHEDULE_PAGE - 1);
        query = ESPORTS_SPORTS.includes(sport)
          ? query.filter("league.name", "imatch", FEATURED_ESPORTS_PATTERN)
          : query.not("league.featured_rank", "is", null);
        // В линии только матчи, которые ещё не начались: на начавшиеся прогноз не принимается.
        const now = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
        const [from, to] =
          day === "today" ? mskDayRange(0) : day === "tomorrow" ? mskDayRange(1) : [mskDayRange(0)[0], mskDayRange(2)[1]];
        query = query
          .gt("starts_at", from > now ? from : now)
          .lt("starts_at", to)
          .eq("status", "SCHEDULED");
        return unwrap(await query) as unknown as ScheduleRow[];
      };
      // PostgREST отдаёт не больше 1000 строк за запрос.
      const rows: ScheduleRow[] = [];
      for (let offset = 0; offset < SCHEDULE_MAX; offset += SCHEDULE_PAGE) {
        const chunk = await page(offset);
        rows.push(...chunk);
        if (chunk.length < SCHEDULE_PAGE) break;
      }
      return rows.map(({ projections = [], ...m }) => ({
        ...m,
        lines: projections.length,
        players: [...new Set(projections.map((p) => p.player?.full_name).filter((n): n is string => Boolean(n)))],
      })) as ScheduleItem[];
    },
  };
}
