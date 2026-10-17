"use client";

import { ChevronUp, Ticket } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { findMultiplier } from "@/features/picks/coupon-logic";
import { usePayoutRules } from "@/features/sports/hooks";
import { formatMultiplier, plural } from "@/lib/format";
import { useCouponStore } from "@/stores/coupon-store";
import { CouponPanel } from "./coupon-panel";

/** Десктоп: закреплённая панель справа. */
export function CouponAside() {
  return (
    <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-[23rem] shrink-0 overflow-y-auto rounded-3xl border border-white/[0.07] bg-surface-1 p-4 lg:block">
      <CouponPanel />
    </aside>
  );
}

/** Смартфон: плавающая плашка над нижней навигацией и шторка с купоном. */
export function CouponMobileBar() {
  const count = useCouponStore((s) => s.picks.length);
  const playType = useCouponStore((s) => s.playType);
  const isOpen = useCouponStore((s) => s.isOpen);
  const setOpen = useCouponStore((s) => s.setOpen);
  const { data: rules = [] } = usePayoutRules();
  const multiplier = findMultiplier(rules, playType, count) ?? findMultiplier(rules, "POWER", count);

  return (
    <>
      {count > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 flex h-14 animate-rise items-center gap-3 rounded-2xl bg-primary px-4 text-primary-foreground shadow-[0_12px_40px_-8px_rgb(212_255_58/0.6)] lg:hidden"
        >
          <span className="flex size-8 items-center justify-center rounded-xl bg-black/15">
            <Ticket className="size-4" />
          </span>
          <span className="text-sm font-extrabold">
            {count} {plural(count, ["выбор", "выбора", "выборов"])}
          </span>
          {multiplier ? <span className="numeric ml-auto text-base font-extrabold">{formatMultiplier(multiplier)}</span> : null}
          <ChevronUp className={multiplier ? "size-5" : "ml-auto size-5"} />
        </button>
      ) : null}
      <Sheet open={isOpen && count > 0} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl border-white/10 px-4 pb-8 pt-6">
          <SheetTitle className="sr-only">Купон прогнозов</SheetTitle>
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15" aria-hidden />
          <CouponPanel onSubmitted={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
