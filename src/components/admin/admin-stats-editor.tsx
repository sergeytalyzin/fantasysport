"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AdminMatch, upsertPlayerStats, useAdminMutation, useMatchPlayers, useMatchProjections } from "@/features/admin/hooks";
import { useMarkets } from "@/features/sports/hooks";
import { ListSkeleton } from "./admin-ui";

const STAT_LABELS: Record<string, string> = {
  goals: "Голы",
  assists: "Передачи",
  shots_on_goal: "Броски в створ",
  saves: "Сейвы",
  shots: "Удары",
  shots_on_target: "Удары в створ",
  passes: "Передачи",
  points: "Очки",
  rebounds: "Подборы",
  threes_made: "Трёхочковые",
};

function PlayerStatsRow({
  match,
  player,
  keys,
  initial,
}: {
  match: AdminMatch;
  player: { id: string; full_name: string };
  keys: string[];
  initial?: { stats: Record<string, number>; did_play: boolean };
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(keys.map((k) => [k, initial?.stats[k]?.toString() ?? ""])),
  );
  const [didPlay, setDidPlay] = useState(initial?.did_play ?? true);
  const mutation = useAdminMutation(upsertPlayerStats, `Статистика: ${player.full_name}`, [["admin", "match-players"]]);
  const locked = Boolean(match.results_confirmed_at);

  const save = () => {
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim() !== "" && Number.isFinite(Number(v))) stats[k] = Number(v);
    mutation.mutate({ matchId: match.id, playerId: player.id, stats, didPlay });
  };

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{player.full_name}</p>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={didPlay} disabled={locked} onChange={(e) => setDidPlay(e.target.checked)} className="accent-[var(--primary)]" />
          Играл
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keys.map((k) => (
          <label key={k} className="text-[0.7rem] text-muted-foreground">
            {STAT_LABELS[k] ?? k}
            <Input
              className="numeric mt-0.5 h-9"
              inputMode="numeric"
              disabled={locked || !didPlay}
              value={values[k]}
              onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {!locked ? (
        <Button size="sm" variant="outline" onClick={save} disabled={mutation.isPending}>
          <Save /> Сохранить
        </Button>
      ) : null}
    </li>
  );
}

/** Ручной ввод статистики — для провайдеров без результатов (например, OddsPapi). */
export function AdminStatsEditor({ match }: { match: AdminMatch }) {
  const { data, isLoading } = useMatchPlayers(match);
  const { data: projections = [] } = useMatchProjections(match.id);
  const { data: markets = [] } = useMarkets();
  const keys = [...new Set(markets.filter((m) => m.sport_id === match.league.sport_id).flatMap((m) => m.components))];

  if (isLoading || !data) return <ListSkeleton rows={4} />;

  // Спортсмены команд + спортсмены с линиями (у OddsPapi команда игрока неизвестна).
  const players = new Map(data.players.map((p) => [p.id, p]));
  for (const p of projections) if (!players.has(p.player.id)) players.set(p.player.id, { ...p.player, position: null, team_id: p.player.team_id ?? "" });

  return (
    <ul className="divide-y divide-white/[0.05]">
      {[...players.values()].map((p) => (
        <PlayerStatsRow
          key={`${p.id}-${match.results_confirmed_at}`}
          match={match}
          player={p}
          keys={keys}
          initial={data.stats.find((s) => s.player_id === p.id)}
        />
      ))}
    </ul>
  );
}
