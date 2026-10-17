"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type CouponPick, type ToggleResult, togglePick } from "@/features/picks/coupon-logic";
import type { PlayType } from "@/types/domain";

interface CouponState {
  picks: CouponPick[];
  playType: PlayType;
  /** Сумма в рублях (строка — чтобы поле ввода можно было очистить). */
  stake: string;
  /** Ключ идемпотентности текущего купона: повторная отправка не спишет сумму дважды. */
  idempotencyKey: string;
  isOpen: boolean;
  toggle: (pick: CouponPick, maxPicks: number) => ToggleResult["event"];
  remove: (projectionId: string) => void;
  updateLine: (projectionId: string, line: number) => void;
  setPlayType: (playType: PlayType) => void;
  setStake: (stake: string) => void;
  setOpen: (open: boolean) => void;
  reset: () => void;
}

const newKey = () => crypto.randomUUID();

export const useCouponStore = create<CouponState>()(
  persist(
    (set, get) => ({
      picks: [],
      playType: "POWER",
      stake: "1000",
      idempotencyKey: newKey(),
      isOpen: false,
      toggle: (pick, maxPicks) => {
        const result = togglePick(get().picks, pick, maxPicks);
        // Любое изменение состава — новый купон, новый ключ.
        if (result.event !== "limit") set({ picks: result.picks, idempotencyKey: newKey() });
        return result.event;
      },
      remove: (projectionId) =>
        set((s) => ({ picks: s.picks.filter((p) => p.projectionId !== projectionId), idempotencyKey: newKey() })),
      updateLine: (projectionId, line) =>
        set((s) => ({
          picks: s.picks.map((p) => (p.projectionId === projectionId ? { ...p, line } : p)),
          idempotencyKey: newKey(),
        })),
      setPlayType: (playType) => set({ playType, idempotencyKey: newKey() }),
      setStake: (stake) => set({ stake: stake.replace(/\D/g, "").slice(0, 9), idempotencyKey: newKey() }),
      setOpen: (isOpen) => set({ isOpen }),
      reset: () => set({ picks: [], idempotencyKey: newKey(), isOpen: false }),
    }),
    {
      name: "pickup-coupon",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ picks: s.picks, playType: s.playType, stake: s.stake }),
      // Восстанавливаем после монтирования, чтобы не было расхождения SSR и клиента.
      skipHydration: true,
    },
  ),
);
