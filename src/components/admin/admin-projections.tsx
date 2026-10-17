"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type AdminMatch,
  type AdminProjection,
  createProjection,
  updateProjection,
  useAdminMutation,
  useMatchPlayers,
  useMatchProjections,
} from "@/features/admin/hooks";
import { useMarkets } from "@/features/sports/hooks";
import { formatLine } from "@/lib/format";
import { ListSkeleton, StatusPill } from "./admin-ui";

const INVALIDATE = [["admin", "projections"], ["board"]];

function ProjectionRow({ projection }: { projection: AdminProjection }) {
  const [line, setLine] = useState(String(projection.line));
  const mutation = useAdminMutation(updateProjection, "Линия обновлена", INVALIDATE);
  const editable = projection.status === "OPEN" || projection.status === "SUSPENDED";
  const parsed = Number(line.replace(",", "."));

  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{projection.player.full_name}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {projection.market.name}
          <StatusPill tone={projection.status === "OPEN" ? "ok" : "muted"}>{projection.status}</StatusPill>
          {projection.source === "manual" ? <StatusPill tone="warn">вручную</StatusPill> : null}
        </p>
      </div>
      {editable ? (
        <>
          <Input className="numeric h-9 w-20 text-center" value={line} onChange={(e) => setLine(e.target.value)} aria-label="Линия" />
          <Button
            size="sm"
            variant="outline"
            disabled={mutation.isPending || !Number.isFinite(parsed) || parsed === projection.line}
            onClick={() => mutation.mutate({ id: projection.id, line: parsed, status: projection.status })}
          >
            OK
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({ id: projection.id, line: projection.line, status: projection.status === "OPEN" ? "SUSPENDED" : "OPEN" })
            }
          >
            {projection.status === "OPEN" ? "Приостановить" : "Открыть"}
          </Button>
        </>
      ) : (
        <span className="numeric text-sm font-bold">{formatLine(projection.line)}</span>
      )}
    </li>
  );
}

function CreateProjection({ match }: { match: AdminMatch }) {
  const { data: markets = [] } = useMarkets();
  const { data } = useMatchPlayers(match);
  const [playerId, setPlayerId] = useState("");
  const [marketId, setMarketId] = useState("");
  const [line, setLine] = useState("");
  const mutation = useAdminMutation(createProjection, "Линия добавлена", INVALIDATE);
  const sportMarkets = markets.filter((m) => m.sport_id === match.league.sport_id);
  const parsed = Number(line.replace(",", "."));

  return (
    <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Новая линия</p>
      <Select value={playerId} onValueChange={setPlayerId}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Спортсмен" />
        </SelectTrigger>
        <SelectContent>
          {(data?.players ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Select value={marketId} onValueChange={setMarketId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Показатель" />
          </SelectTrigger>
          <SelectContent>
            {sportMarkets.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input className="numeric w-24 text-center" placeholder="2,5" value={line} onChange={(e) => setLine(e.target.value)} />
      </div>
      <Button
        className="w-full"
        disabled={!playerId || !marketId || !(parsed > 0) || mutation.isPending || match.status !== "SCHEDULED"}
        onClick={() => mutation.mutate({ matchId: match.id, playerId, marketId, line: parsed }, { onSuccess: () => setLine("") })}
      >
        <Plus /> Добавить линию
      </Button>
      <p className="text-xs text-muted-foreground">Линия — число с шагом 0,5. Добавлять можно только до начала матча.</p>
    </div>
  );
}

export function AdminProjections({ match }: { match: AdminMatch }) {
  const { data = [], isLoading } = useMatchProjections(match.id);
  return (
    <div className="space-y-3">
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Линий нет.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {data.map((p) => (
            <ProjectionRow key={`${p.id}-${p.line}-${p.status}`} projection={p} />
          ))}
        </ul>
      )}
      <CreateProjection match={match} />
    </div>
  );
}
