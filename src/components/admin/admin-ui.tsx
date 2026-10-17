import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function AdminPanel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface-1">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <h2 className="font-display text-base font-bold">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-1 p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p
        className={cn(
          "numeric mt-1 text-2xl font-extrabold",
          tone === "warn" && "text-gold",
          tone === "ok" && "text-over",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

export function StatusPill({ children, tone }: { children: ReactNode; tone: "ok" | "warn" | "bad" | "muted" | "brand" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide",
        tone === "ok" && "bg-over/15 text-over",
        tone === "warn" && "bg-gold/15 text-gold",
        tone === "bad" && "bg-under/15 text-under",
        tone === "muted" && "bg-white/10 text-muted-foreground",
        tone === "brand" && "bg-primary/15 text-primary",
      )}
    >
      {children}
    </span>
  );
}
