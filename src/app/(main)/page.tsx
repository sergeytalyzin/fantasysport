import { Suspense } from "react";
import { BoardHero } from "@/components/picks/board-hero";
import { CouponAside, CouponMobileBar } from "@/components/picks/coupon-dock";
import { HomeView } from "@/components/picks/home-view";

export default function HomePage() {
  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        <BoardHero />
        <HomeView />
      </div>
      {/* Лидеры месяца зависят от текущей даты (МСК) — вычисляется при запросе. */}
      <Suspense fallback={<div className="hidden w-[23rem] shrink-0 lg:block" />}>
        <CouponAside />
      </Suspense>
      <CouponMobileBar />
    </div>
  );
}
