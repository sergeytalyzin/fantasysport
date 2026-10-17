"use client";

import { Input } from "@/components/ui/input";
import { formatRub } from "@/lib/format";
import { cn } from "@/lib/utils";

const QUICK = [500, 1_000, 5_000, 10_000];

export function StakeInput({
  value,
  onChange,
  balance,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  balance: number | null;
  error: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <label htmlFor="stake" className="font-semibold text-muted-foreground">
          Сумма прогноза
        </label>
        {balance !== null ? <span className="text-muted-foreground">Баланс: {formatRub(balance)}</span> : null}
      </div>
      <div className="relative">
        <Input
          id="stake"
          inputMode="numeric"
          autoComplete="off"
          value={value ? Number(value).toLocaleString("ru-RU") : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          className="numeric h-14 pr-10 text-xl font-bold"
          placeholder="0"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">₽</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {QUICK.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onChange(String(amount))}
            className={cn(
              "h-8 rounded-lg bg-surface-3 text-xs font-bold transition-colors hover:bg-white/10",
              Number(value) === amount && "bg-primary/15 text-primary",
            )}
          >
            {amount.toLocaleString("ru-RU")}
          </button>
        ))}
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
