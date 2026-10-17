import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchView } from "@/components/matches/match-view";
import { CouponAside, CouponMobileBar } from "@/components/picks/coupon-dock";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Матч" };

// Параметры маршрута известны только при запросе — доступ к ним внутри Suspense.
export default function MatchPage({ params }: PageProps<"/matches/[id]">) {
  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1">
        <Suspense fallback={<Skeleton className="h-56 rounded-3xl" />}>
          {params.then(({ id }) => (
            <MatchView matchId={id} />
          ))}
        </Suspense>
      </div>
      {/* Лидеры месяца зависят от текущей даты (МСК) — вычисляется при запросе. */}
      <Suspense fallback={<div className="hidden w-[23rem] shrink-0 lg:block" />}>
        <CouponAside />
      </Suspense>
      <CouponMobileBar />
    </div>
  );
}
