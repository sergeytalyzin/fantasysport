import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { RulesView } from "@/components/rules/rules-view";

export const metadata: Metadata = { title: "Как играть" };

export default function RulesPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Как играть" description="Правила PICKUP: прогнозы, выплаты, расчёт, бонусы и рейтинг." />
      <RulesView />
    </div>
  );
}
