"use client";

import { Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveMatch } from "@/features/live/hooks";
import type { MatchListItem } from "@/features/matches/hooks";
import { TeamBadge } from "@/components/matches/team-badge";
import { pairColors } from "@/lib/team-color";
import { FootballPitch, MatchTimeline } from "./football-pitch";
import { HockeyRink } from "./hockey-rink";
import { EventFeed, Leaders, Scoreboard } from "./live-parts";

const SOURCE: Record<string, string> = {
  nhl: "Данные НХЛ · обновление каждые ~15 с",
  apifootball: "Данные API-Football · обновление раз в ~3 мин",
};

const REASONS: Record<string, string> = {
  unsupported: "Онлайн-трансляция для этой лиги пока недоступна — источник live-данных не подключён.",
  game_not_found: "Ищем матч у источника live-данных. Попробуйте обновить страницу через пару минут.",
  provider_error: "Источник live-данных временно недоступен.",
};

export function LiveCenter({ match }: { match: Omit<MatchListItem, "lines"> }) {
  const { data, isLoading } = useLiveMatch(match.id);
  const snapshot = data?.snapshot;
  const [homeColor, awayColor] = pairColors(match.home, match.away);

  if (isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (!snapshot) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 px-4 py-8 text-center sm:px-6 sm:py-12">
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
          {[match.home, match.away].map((t, i) => (
            <div key={t.id} className={i === 0 ? "order-1 flex flex-col items-center gap-2" : "order-3 flex flex-col items-center gap-2"}>
              <TeamBadge team={t} color={i === 0 ? homeColor : awayColor} className="size-12 text-xs" />
              <span className="text-sm font-bold leading-tight">{t.name}</span>
            </div>
          ))}
          <span className="order-2 text-xs font-bold uppercase text-muted-foreground">
            {match.status === "FINISHED" ? "Завершён" : match.status === "LIVE" ? "Идёт" : "VS"}
          </span>
        </div>
        <Radio className="mt-2 size-7 text-muted-foreground" />
        <p className="max-w-sm text-sm text-muted-foreground">{REASONS[data?.reason ?? "unsupported"]}</p>
      </div>
    );
  }

  const minute = parseInt(snapshot.status, 10) || (snapshot.state === "FINAL" ? 90 : 0);
  return (
    <div className="space-y-4">
      <section className="space-y-5 rounded-3xl border border-white/[0.08] bg-surface-1 p-4 sm:p-6">
        <Scoreboard snapshot={snapshot} home={match.home} away={match.away} colors={[homeColor, awayColor]} />

        {snapshot.surface === "rink" ? (
          <div className="space-y-2">
            <HockeyRink events={snapshot.events} homeColor={homeColor} awayColor={awayColor} />
            <Legend homeName={match.home.abbr} awayName={match.away.abbr} homeColor={homeColor} awayColor={awayColor} goalLabel="бросок" />
          </div>
        ) : snapshot.surface === "pitch" ? (
          <div className="space-y-5">
            {snapshot.events.some((e) => e.x != null) ? (
              <>
                <FootballPitch events={snapshot.events} homeColor={homeColor} awayColor={awayColor} />
                <Legend homeName={match.home.abbr} awayName={match.away.abbr} homeColor={homeColor} awayColor={awayColor} goalLabel="удар" />
              </>
            ) : null}
            <MatchTimeline events={snapshot.events} minute={minute} homeColor={homeColor} awayColor={awayColor} />
            {snapshot.events.some((e) => e.x != null) ? null : (
              <p className="pt-2 text-center text-[0.7rem] text-muted-foreground">
                Сверху события {match.home.short_name}, снизу — {match.away.short_name}. Координаты ударов источник не передаёт.
              </p>
            )}
          </div>
        ) : null}

        <p className="text-center text-[0.7rem] text-muted-foreground">{SOURCE[snapshot.provider]}</p>
      </section>

      {snapshot.leaders.length > 0 ? (
        <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
          <h2 className="border-b border-white/[0.06] px-4 py-3 font-display text-base font-bold">Самые результативные</h2>
          <Leaders snapshot={snapshot} homeName={match.home.short_name} awayName={match.away.short_name} />
        </section>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
        <h2 className="border-b border-white/[0.06] px-4 py-3 font-display text-base font-bold">События матча</h2>
        <EventFeed events={snapshot.events} homeName={match.home.short_name} awayName={match.away.short_name} />
      </section>
    </div>
  );
}

function Legend({
  homeName,
  awayName,
  homeColor,
  awayColor,
  goalLabel,
}: {
  homeName: string;
  awayName: string;
  homeColor: string;
  awayColor: string;
  goalLabel: string;
}) {
  return (
    <div className="space-y-2 text-[0.7rem] text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: awayColor }} /> ← атакует {awayName}
        </span>
        <span className="flex items-center gap-1.5">
          атакует {homeName} → <span className="size-2.5 rounded-full" style={{ background: homeColor }} />
        </span>
      </div>
      <div className="flex items-center justify-center gap-4">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-full border-2 border-white bg-white/40" /> гол
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-white/70" /> {goalLabel} в створ
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full border border-white/70" /> мимо
        </span>
      </div>
    </div>
  );
}
