import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Рейтинг" };

export default function LeaderboardPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Рейтинг" description="Соревнуйтесь с другими игроками за первое место." />
      {/* Текущий месяц (МСК) вычисляется при запросе, а не при сборке. */}
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <LeaderboardView />
      </Suspense>
    </div>
  );
}
