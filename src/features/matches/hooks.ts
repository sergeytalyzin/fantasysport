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
 * «Главные события»: больше линий, затем раньше начало.
 * Статистики популярности пока нет — это честный порядок по доступным данным.
 */
export function topMatches(matches: MatchListItem[], count = 6): MatchListItem[] {
  return [...matches]
    .sort(
      (a, b) =>
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
      // Только матчи, на которые были линии (projections!inner).
      let query = getSupabaseBrowserClient()
        .from("matches")
        .select(`${MATCH_SELECT}, projections!inner(id)`)
        .limit(1, { referencedTable: "projections" })
        .lte("starts_at", new Date(now).toISOString())
        .gt("starts_at", new Date(now - 4 * 3600_000).toISOString())
        .is("results_confirmed_at", null)
        .neq("status", "CANCELLED")
        .order("starts_at", { ascending: false })
        .limit(10);
      if (sport) query = query.eq("league.sport_id", sport);
      if (league) query = query.eq("league.code", league);
      const rows = unwrap(await query) as unknown as (Omit<MatchListItem, "lines"> & { projections?: unknown })[];
      return rows.map((row) => {
        const m = { ...row };
        delete m.projections;
        return m as Omit<MatchListItem, "lines">;
      });
    },
  });
}

/** «upcoming» — всё актуальное (идёт или впереди) на сегодня и два следующих дня. */
export type ScheduleDay = "live" | "upcoming" | "today" | "tomorrow" | "after";

export interface ScheduleItem extends MatchListItem {
  league: MatchListItem["league"] & { name: string; country: string | null; sort_order: number };
}

const MSK_MS = 3 * 3600_000;
const SCHEDULE_PAGE = 1000;
const DAY_OFFSET = { today: 0, tomorrow: 1, after: 2 } as const;
const SCHEDULE_MAX = 10_000;

/** Границы московских суток (UTC) со смещением в днях. */
function mskDayRange(offsetDays: number): [string, string] {
  const now = Date.now() + MSK_MS;
  const start = Math.floor(now / 86_400_000) * 86_400_000 + offsetDays * 86_400_000 - MSK_MS;
  return [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()];
}

/**
 * Полное расписание вида спорта: все реальные матчи всех турниров
 * (с линиями и без). Число открытых линий считается в том же запросе.
 */
export function useSchedule(sport: string | null, day: ScheduleDay) {
  return useQuery({
    queryKey: ["schedule", sport, day],
    refetchInterval: 120_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const page = async (offset: number) => {
        let query = getSupabaseBrowserClient()
          .from("matches")
          .select(
            `id, starts_at, status, source,
             league:leagues!inner(code, short_name, sport_id, name, country, sort_order),
             home:teams!matches_home_team_id_fkey(${TEAM}),
             away:teams!matches_away_team_id_fkey(${TEAM}),
             projections(count)`,
          )
          .eq("projections.status", "OPEN")
          .neq("status", "CANCELLED")
          .order("starts_at")
          .order("id")
          .range(offset, offset + SCHEDULE_PAGE - 1);
        if (sport) query = query.eq("league.sport_id", sport);
        if (day === "live") {
          query = query.eq("status", "LIVE");
        } else if (day === "upcoming") {
          // Начавшиеся до 3 часов назад могут ещё идти.
          const from = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3 * 3600_000).toISOString();
          query = query.gte("starts_at", from).lt("starts_at", mskDayRange(2)[1]).neq("status", "FINISHED");
        } else {
          const [from, to] = mskDayRange(DAY_OFFSET[day]);
          query = query.gte("starts_at", from).lt("starts_at", to);
        }
        return unwrap(await query) as unknown as (Omit<ScheduleItem, "lines"> & { projections?: { count: number }[] })[];
      };
      // PostgREST отдаёт не больше 1000 строк за запрос, а за сутки по всем видам спорта матчей больше.
      const rows: Awaited<ReturnType<typeof page>> = [];
      for (let offset = 0; offset < SCHEDULE_MAX; offset += SCHEDULE_PAGE) {
        const chunk = await page(offset);
        rows.push(...chunk);
        if (chunk.length < SCHEDULE_PAGE) break;
      }
      return rows.map(({ projections, ...m }) => ({ ...m, lines: projections?.[0]?.count ?? 0 })) as ScheduleItem[];
    },
  });
}
