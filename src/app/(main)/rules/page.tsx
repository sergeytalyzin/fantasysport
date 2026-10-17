import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { BoardHero } from "@/components/picks/board-hero";
import { RulesView } from "@/components/rules/rules-view";

export const metadata: Metadata = { title: "Как играть" };

export default function RulesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Как играть" description="Правила PICKUP: прогнозы, выплаты, расчёт, бонусы и рейтинг." />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Смартфон — над правилами, десктоп — закреплён сбоку. */}
        <aside className="lg:sticky lg:top-20 lg:order-last lg:w-[23rem] lg:shrink-0">
          <BoardHero />
        </aside>
        <div className="min-w-0 flex-1">
          <RulesView />
        </div>
      </div>
    </div>
  );
}
