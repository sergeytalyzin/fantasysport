"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator, Download, ListChecks, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { invokeSportsSync, settleReadyMatches, useAdminMutation, useSyncRuns } from "@/features/admin/hooks";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { AdminPanel, ListSkeleton, StatusPill } from "./admin-ui";

const INVALIDATE = [["admin"], ["board"]];

function ProviderStatus() {
  const status = useQuery({
    queryKey: ["admin", "provider-status"],
    queryFn: () => invokeSportsSync({ action: "status" }) as Promise<{
      providers: { id: string; capabilities: { lines: boolean; results: boolean } }[];
      results_providers?: { id: string; leagues: string[] }[];
      oddspapi_key_configured: boolean;
      apifootball_key_configured?: boolean;
    }>,
    retry: false,
  });

  if (status.isLoading) return <ListSkeleton rows={2} />;
  if (status.error) {
    return (
      <p className="px-4 py-3 text-sm text-destructive">
        Edge Function недоступна: {errorMessage(status.error)}. Проверьте деплой функции sports-sync (см. README).
      </p>
    );
  }
  return (
    <ul className="divide-y divide-white/[0.05]">
      {status.data?.providers.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
          <span className="font-bold">{p.id}</span>
          <StatusPill tone={p.capabilities.lines ? "ok" : "muted"}>линии</StatusPill>
          <StatusPill tone={p.capabilities.results ? "ok" : "warn"}>{p.capabilities.results ? "результаты" : "результаты вручную"}</StatusPill>
        </li>
      ))}
      {status.data?.results_providers?.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="font-bold">{p.id}</span>
          <StatusPill tone="ok">статистика</StatusPill>
          <span className="text-xs text-muted-foreground">{p.leagues.join(", ")}</span>
        </li>
      ))}
      <li className="space-y-0.5 px-4 py-3 text-xs text-muted-foreground">
        <p>Ключ OddsPapi: {status.data?.oddspapi_key_configured ? "задан в Supabase Secrets" : "не задан — линии от Demo Provider"}</p>
        <p>Ключ API-Football: {status.data?.apifootball_key_configured ? "задан" : "не задан — статистика РПЛ/АПЛ/ЛЧ вводится вручную"}</p>
      </li>
    </ul>
  );
}

export function AdminProviders() {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const runs = useSyncRuns(onlyErrors);
  const sync = useAdminMutation((action: string) => invokeSportsSync({ action }), "Готово", INVALIDATE);
  const settle = useAdminMutation(settleReadyMatches, "Расчёт выполнен", INVALIDATE);

  return (
    <>
      <h1 className="text-2xl font-extrabold">Спортивные API</h1>
      <AdminPanel title="Провайдеры">
        <ProviderStatus />
      </AdminPanel>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => sync.mutate("sync")} disabled={sync.isPending}>
          <RefreshCw className={sync.isPending ? "animate-spin" : undefined} /> Полная синхронизация
        </Button>
        <Button variant="outline" onClick={() => sync.mutate("lines")} disabled={sync.isPending}>
          <Download /> Только линии
        </Button>
        <Button variant="outline" onClick={() => sync.mutate("results")} disabled={sync.isPending}>
          <ListChecks /> Только результаты
        </Button>
        <Button variant="secondary" onClick={() => settle.mutate(undefined)} disabled={settle.isPending}>
          <Calculator /> Рассчитать готовые матчи
        </Button>
      </div>

      <AdminPanel
        title="Журнал синхронизаций"
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Только ошибки <Switch checked={onlyErrors} onCheckedChange={setOnlyErrors} />
          </label>
        }
      >
        {runs.isLoading ? (
          <ListSkeleton />
        ) : (runs.data?.length ?? 0) === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Записей нет</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {runs.data?.map((r) => (
              <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={r.status === "SUCCESS" ? "ok" : r.status === "ERROR" ? "bad" : "warn"}>{r.status}</StatusPill>
                  <span className="font-semibold">
                    {r.provider} · {r.job}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(r.started_at)}</span>
                </div>
                {r.error ? <p className="break-words text-xs text-destructive">{r.error}</p> : null}
                {r.status === "SUCCESS" ? (
                  <p className="font-mono text-[0.7rem] text-muted-foreground">{JSON.stringify(r.details)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
    </>
  );
}
