"use client";

import { Archive, Loader2, Search, Trophy } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { Chip, ChipRow } from "@/components/sports/chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/auth-provider";
import {
  type LeaderboardScope,
  useLeaderboardPeriods,
  useMonthlyLeaderboard,
  useMyMonthlyRank,
  useMyOverallRank,
  useOverallLeaderboard,
} from "@/features/leaderboard/hooks";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { currentMskPeriod, formatPeriod, formatRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MonthlyRows, OverallRows } from "./leaderboard-rows";

type Kind = "overall" | "monthly";
const SCOPES: { value: LeaderboardScope; label: string }[] = [
  { value: "top10", label: "ТОП-10" },
  { value: "top100", label: "ТОП-100" },
  { value: "all", label: "Все" },
];

function MyPosition({ kind, year, month }: { kind: Kind; year: number; month: number }) {
  const overall = useMyOverallRank();
  const monthly = useMyMonthlyRank(year, month);
  const data = kind === "overall" ? overall.data : monthly.data;
  if (!data) return null;
  return (
    <div className="flex items-center justify-between rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground">Ваше место</p>
        <p className="numeric text-2xl font-extrabold text-primary">
          {data.rank} <span className="text-sm font-semibold text-muted-foreground">из {data.total_players}</span>
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs font-semibold text-muted-foreground">{kind === "overall" ? "Капитал" : "Прибыль за месяц"}</p>
        <p className="numeric text-lg font-extrabold">
          {kind === "overall" ? formatRub(data.capital ?? 0) : formatRub(data.profit, { sign: true })}
        </p>
      </div>
    </div>
  );
}

export function LeaderboardView() {
  const { user } = useAuth();
  const current = currentMskPeriod();
  const [kind, setKind] = useState<Kind>("overall");
  const [scope, setScope] = useState<LeaderboardScope>("top100");
  const [period, setPeriod] = useState(`${current.year}-${current.month}`);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [year, month] = period.split("-").map(Number);

  const periods = useLeaderboardPeriods();
  const overall = useOverallLeaderboard(search, scope);
  const monthly = useMonthlyLeaderboard(year, month, search, scope);
  const query = kind === "overall" ? overall : monthly;
  const isArchive = kind === "monthly" && !(year === current.year && month === current.month);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist">
        {(["overall", "monthly"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "h-10 rounded-xl text-sm font-bold transition-colors",
              kind === k ? "bg-surface-3 text-foreground shadow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k === "overall" ? "Общий" : "Месячный"}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {kind === "overall"
          ? "Капитал = баланс + суммы в активных прогнозах. Прибыль не включает бонусы."
          : "Чистая прибыль от рассчитанных прогнозов за месяц (МСК). Бонусы не учитываются."}
      </p>

      {user ? <MyPosition kind={kind} year={year} month={month} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <ChipRow className="mx-0 px-0">
          {SCOPES.map((s) => (
            <Chip key={s.value} active={scope === s.value} onClick={() => setScope(s.value)} className="h-8 text-xs">
              {s.label}
            </Chip>
          ))}
        </ChipRow>
        {kind === "monthly" ? (
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-auto min-w-40 rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(periods.data ?? [{ year: current.year, month: current.month, is_current: true }]).map((p) => (
                <SelectItem key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                  {formatPeriod(p.year, p.month)}
                  {p.is_current ? " · текущий" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Поиск по никнейму"
          className="pl-10"
          aria-label="Поиск по никнейму"
        />
      </label>

      {isArchive ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Archive className="size-3.5" /> Архив: места зафиксированы после окончания месяца.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
        {query.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : (query.data?.pages.flat().length ?? 0) === 0 ? (
          <EmptyState icon={<Trophy className="size-10" />} title={search ? "Никого не нашли" : "Рейтинг пока пуст"}>
            {kind === "monthly" ? "Месячный рейтинг формируется по рассчитанным прогнозам." : null}
          </EmptyState>
        ) : kind === "overall" ? (
          <OverallRows rows={overall.data?.pages.flat() ?? []} meId={user?.id ?? null} />
        ) : (
          <MonthlyRows rows={monthly.data?.pages.flat() ?? []} meId={user?.id ?? null} />
        )}
      </div>

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null} Показать ещё
          </Button>
        </div>
      ) : null}
    </div>
  );
}
