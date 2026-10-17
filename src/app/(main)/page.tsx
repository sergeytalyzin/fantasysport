import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import Link from "next/link";
import { CouponAside, CouponMobileBar } from "@/components/picks/coupon-dock";
import { HomeView } from "@/components/picks/home-view";
import { MonthlyPrizeBanner } from "@/components/picks/monthly-prize-banner";

export default function HomePage() {
  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        <h1 className="sr-only">PICKUP — прогнозы на статистику спортсменов</h1>
        {/* На смартфоне в шапке нет разделов — ссылка на правила здесь. */}
        <Link
          href="/rules"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3.5 text-sm font-bold text-primary transition-colors hover:bg-primary/15 lg:hidden"
        >
          <BookOpen className="size-4" /> Как играть
        </Link>
        <MonthlyPrizeBanner />
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
