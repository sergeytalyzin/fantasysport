"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useAdminDashboard } from "@/features/admin/hooks";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatNumber, formatRubCompact } from "@/lib/format";
import { StatCard } from "./admin-ui";

export function AdminDashboard() {
  const { data, isLoading, error } = useAdminDashboard();
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Обзор</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Пользователей" value={formatNumber(data.users_total)} />
        <StatCard label="Новых за 24 ч" value={formatNumber(data.users_today)} />
        <StatCard label="Капитал игроков" value={formatRubCompact(data.capital_total)} />
        <StatCard label="В активных купонах" value={formatRubCompact(data.reserved_total)} />
        <StatCard label="Активных купонов" value={formatNumber(data.lineups_pending)} />
        <StatCard label="Купонов за 24 ч" value={formatNumber(data.lineups_today)} />
        <StatCard label="Открытых линий" value={formatNumber(data.projections_open)} tone={data.projections_open > 0 ? "ok" : "warn"} />
        <StatCard
          label="Ждут результатов"
          value={formatNumber(data.matches_awaiting_results)}
          tone={data.matches_awaiting_results > 0 ? "warn" : undefined}
        />
        <StatCard label="Ошибок синхр. за 24 ч" value={formatNumber(data.sync_errors_24h)} tone={data.sync_errors_24h > 0 ? "warn" : "ok"} />
        <StatCard
          label="Последняя синхронизация"
          value={<span className="text-base">{data.last_sync_at ? formatDateTime(data.last_sync_at) : "не было"}</span>}
        />
      </div>
    </div>
  );
}
