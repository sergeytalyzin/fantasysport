"use client";

import { Shield } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { teamColor } from "@/lib/team-color";
import { cn } from "@/lib/utils";
import type { TeamRef } from "@/types/domain";

// Эти источники сами отдают уменьшенные копии (SVG NHL, /small TheSportsDB, ?width Commons) —
// повторная оптимизация на Vercel не нужна и не тратит лимит преобразований.
const PRESIZED = /^https:\/\/(assets\.nhle\.com|r2\.thesportsdb\.com|www\.thesportsdb\.com|commons\.wikimedia\.org)\//;

/**
 * Эмблема команды: логотип на светлой подложке, если он есть; аббревиатура на цвете
 * команды, если логотипа нет; нейтральная иконка, если логотип не загрузился.
 */
export function TeamBadge({ team, color: override, className }: { team: TeamRef; color?: string; className?: string }) {
  const color = override ?? teamColor(team);
  const [failed, setFailed] = useState<string | null>(null);
  const logo = team.logo_url && failed !== team.logo_url ? team.logo_url : null;
  const broken = Boolean(team.logo_url) && !logo;

  return (
    <span
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-display text-xs font-extrabold text-white shadow-lg",
        className,
      )}
      style={{
        // Эмблемы рассчитаны на светлый фон: тёмные логотипы не теряются.
        background: logo
          ? "#f4f6f8"
          : broken
            ? "var(--surface-3)"
            : `linear-gradient(150deg, ${color}, color-mix(in oklab, ${color} 45%, #07090d))`,
      }}
      title={team.name}
    >
      {logo ? (
        <span className="relative size-[78%]">
          <Image
            src={logo}
            alt={team.name}
            fill
            sizes="96px"
            unoptimized={PRESIZED.test(logo)}
            className="object-contain"
            onError={() => setFailed(logo)}
          />
        </span>
      ) : broken ? (
        <Shield className="size-1/2 text-muted-foreground" aria-label={team.name} />
      ) : (
        <span className="drop-shadow">{team.abbr}</span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
    </span>
  );
}
