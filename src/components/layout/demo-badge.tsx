import { cn } from "@/lib/utils";

/** Явная пометка тестовых данных Demo Provider. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Тестовые данные Demo Provider: матчи и статистика сгенерированы"
      className={cn(
        "inline-flex items-center rounded-md border border-dashed border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-gold",
        className,
      )}
    >
      Демо
    </span>
  );
}
