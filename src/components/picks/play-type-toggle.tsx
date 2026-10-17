"use client";

import { Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlayType } from "@/types/domain";

const OPTIONS: { value: PlayType; title: string; hint: string; icon: typeof Zap }[] = [
  { value: "POWER", title: "Power Play", hint: "Все выборы должны сыграть", icon: Zap },
  { value: "FLEX", title: "Flex Play", hint: "Можно ошибиться", icon: Shield },
];

export function PlayTypeToggle({
  value,
  onChange,
  flexDisabledReason,
}: {
  value: PlayType;
  onChange: (value: PlayType) => void;
  flexDisabledReason: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Тип купона">
      {OPTIONS.map(({ value: v, title, hint, icon: Icon }) => {
        const disabled = v === "FLEX" && flexDisabledReason !== null;
        const active = value === v && !disabled;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? (flexDisabledReason ?? undefined) : undefined}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-2xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40",
              active ? "border-primary bg-primary/10" : "border-white/10 bg-surface-2 hover:border-white/20",
            )}
          >
            <span className={cn("flex items-center gap-1.5 text-sm font-bold", active && "text-primary")}>
              <Icon className="size-4" /> {title}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{disabled ? flexDisabledReason : hint}</span>
          </button>
        );
      })}
    </div>
  );
}
