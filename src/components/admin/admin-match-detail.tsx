"use client";

import { Ban, CheckCheck, Flag, Link2, Tv } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type AdminMatch,
  confirmMatchResults,
  setMatchStatus,
  setMatchStream,
  useAdminMutation,
} from "@/features/admin/hooks";
import { formatDateTime } from "@/lib/format";
import { parseStreamUrl, STREAM_PROVIDER_NAMES } from "@/lib/stream-embed";
import { AdminProjections } from "./admin-projections";
import { AdminStatsEditor } from "./admin-stats-editor";

const INVALIDATE = [["admin"], ["board"]];

function ResultLink({ match }: { match: AdminMatch }) {
  const link = match.result_link;
  if (!link) return null;
  const unmatched = link.unmatched_players ?? [];
  return (
    <div className="space-y-1.5 rounded-2xl border border-white/[0.06] bg-surface-2 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Link2 className="size-4 text-primary" /> Статистика: {link.provider} · игра {link.external_game_id}
      </p>
      <p className="text-xs text-muted-foreground">
        Сопоставлено спортсменов: {link.matched_players} · проверено {formatDateTime(link.last_checked_at)}
      </p>
      {unmatched.length > 0 ? (
        <p className="rounded-xl bg-gold/10 px-2.5 py-1.5 text-xs text-gold">
          Не сопоставлены: {unmatched.join(", ")}. Внесите их статистику (или отметьте «не играл») во вкладке «Статистика» и
          подтвердите результаты вручную.
        </p>
      ) : null}
    </div>
  );
}

function StreamField({ match }: { match: AdminMatch }) {
  const [url, setUrl] = useState(match.stream_url ?? "");
  const save = useAdminMutation(setMatchStream, "Трансляция сохранена", [...INVALIDATE, ["match", match.id]]);
  const trimmed = url.trim();
  const embed = trimmed ? parseStreamUrl(trimmed, window.location.hostname) : null;
  const invalid = Boolean(trimmed) && !embed;

  return (
    <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-surface-2 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Tv className="size-4 text-primary" /> Трансляция
      </p>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="Ссылка на трансляцию"
          inputMode="url"
          aria-invalid={invalid}
        />
        <Button disabled={invalid || save.isPending || trimmed === (match.stream_url ?? "")} onClick={() => save.mutate({ matchId: match.id, url: trimmed || null })}>
          {trimmed ? "Сохранить" : "Убрать"}
        </Button>
      </div>
      <p className={invalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {invalid
          ? "Ссылка не распознана. Поддерживаются YouTube, Twitch, VK Видео и Rutube."
          : embed
            ? `Плеер: ${STREAM_PROVIDER_NAMES[embed.provider]}.`
            : "Только официальные бесплатные трансляции правообладателя, разрешающие встраивание (YouTube, Twitch, VK Видео, Rutube)."}
      </p>
    </div>
  );
}

function ResultsActions({ match }: { match: AdminMatch }) {
  const [home, setHome] = useState(match.home_score?.toString() ?? "");
  const [away, setAway] = useState(match.away_score?.toString() ?? "");
  const status = useAdminMutation(setMatchStatus, "Статус матча обновлён", INVALIDATE);
  const confirm = useAdminMutation(confirmMatchResults, "Результаты подтверждены, прогнозы рассчитаны", INVALIDATE);
  const locked = Boolean(match.results_confirmed_at) || match.status === "CANCELLED";

  if (locked) {
    return (
      <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted-foreground">
        Результаты зафиксированы{match.results_confirmed_at ? ` ${formatDateTime(match.results_confirmed_at)}` : ""}. Повторный
        приём результатов игнорируется, повторного начисления не будет.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input className="numeric w-20 text-center" inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value)} aria-label="Счёт хозяев" />
        <span className="font-bold">:</span>
        <Input className="numeric w-20 text-center" inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value)} aria-label="Счёт гостей" />
        <Button
          variant="outline"
          className="flex-1"
          disabled={status.isPending}
          onClick={() =>
            status.mutate({ matchId: match.id, status: "FINISHED", home: home ? Number(home) : null, away: away ? Number(away) : null })
          }
        >
          <Flag /> Завершить
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={match.status !== "FINISHED" || confirm.isPending} onClick={() => confirm.mutate(match.id)}>
          <CheckCheck /> Подтвердить статистику
        </Button>
        <Button
          variant="destructive"
          disabled={status.isPending}
          onClick={() => {
            if (window.confirm("Отменить матч? Все выборы на него будут аннулированы.")) {
              status.mutate({ matchId: match.id, status: "CANCELLED" });
            }
          }}
        >
          <Ban /> Отменить матч
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Расчёт выполняется только после подтверждения статистики. Неучастие спортсмена или отсутствие показателя аннулирует выбор.
      </p>
    </div>
  );
}

export function AdminMatchDetail({ match, onClose }: { match: AdminMatch | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(match)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto border-white/10 sm:max-w-xl">
        {match ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-display">
                {match.home.name} — {match.away.name}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                {match.league.short_name} · {formatDateTime(match.starts_at)}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <Tabs defaultValue="results">
                <TabsList className="w-full">
                  <TabsTrigger value="results">Результаты</TabsTrigger>
                  <TabsTrigger value="stats">Статистика</TabsTrigger>
                  <TabsTrigger value="lines">Линии</TabsTrigger>
                </TabsList>
                <TabsContent value="results" className="space-y-3 pt-3">
                  <StreamField key={`stream-${match.id}`} match={match} />
                  <ResultLink match={match} />
                  <ResultsActions key={match.id} match={match} />
                </TabsContent>
                <TabsContent value="stats" className="pt-3">
                  <AdminStatsEditor match={match} />
                </TabsContent>
                <TabsContent value="lines" className="pt-3">
                  <AdminProjections match={match} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
