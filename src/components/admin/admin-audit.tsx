"use client";

import { useAuditLogs } from "@/features/admin/hooks";
import { formatDateTime } from "@/lib/format";
import { AdminPanel, ListSkeleton, StatusPill } from "./admin-ui";

export function AdminAudit() {
  const { data = [], isLoading } = useAuditLogs();
  return (
    <>
      <h1 className="text-2xl font-extrabold">Журнал аудита</h1>
      <AdminPanel title="Последние 200 действий администраторов">
        {isLoading ? (
          <ListSkeleton />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.map((log) => (
              <li key={log.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="brand">{log.action}</StatusPill>
                  <span className="font-semibold">{log.admin?.nickname ?? "система"}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(log.created_at)} · {log.target_type} {log.target_id ?? ""}
                  </span>
                </div>
                <p className="break-all font-mono text-[0.7rem] text-muted-foreground">{JSON.stringify(log.payload)}</p>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
    </>
  );
}
