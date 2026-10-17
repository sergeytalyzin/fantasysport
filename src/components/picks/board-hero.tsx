"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { usePayoutRules } from "@/features/sports/hooks";
import { formatMultiplier } from "@/lib/format";

export function BoardHero() {
  const { data: rules = [] } = usePayoutRules();
  const power = rules.filter((r) => r.play_type === "POWER" && r.is_active).sort((a, b) => a.picks_count - b.picks_count);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1 p-5 sm:p-7 landscape:max-lg:p-4">
      <div
        className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/20 blur-3xl"
        aria-hidden
      />
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Больше или меньше?</p>
      <h1 className="mt-2 max-w-xl text-xl font-extrabold leading-tight sm:text-4xl landscape:max-lg:text-xl">
        Собери купон из 2–6 прогнозов на статистику спортсменов
      </h1>
      <p className="mt-2 hidden max-w-lg text-sm text-muted-foreground sm:block landscape:max-lg:hidden">
        Голы, броски, очки, убийства — хоккей, футбол, баскетбол, Dota 2 и Counter-Strike 2. Играйте на виртуальные рубли и
        поднимайтесь в рейтинге.
      </p>
      <Link
        href="/rules"
        className="relative mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 text-xs font-bold text-primary transition-colors hover:bg-primary/15 lg:hidden"
      >
        <BookOpen className="size-3.5" /> Как играть
      </Link>
      {power.length > 0 ? (
        <ul className="scrollbar-none -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:mt-5 sm:flex-wrap sm:px-0" aria-label="Множители Power Play">
          {power.map((r) => (
            <li key={r.id} className="shrink-0 rounded-xl border border-white/10 bg-surface-2 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{r.picks_count} выб.</span>{" "}
              <span className="numeric font-extrabold text-primary">{formatMultiplier(Number(r.multiplier))}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
