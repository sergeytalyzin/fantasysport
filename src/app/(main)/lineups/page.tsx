import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { MyLineups } from "@/components/lineups/my-lineups";

export const metadata: Metadata = { title: "Мои прогнозы" };

export default function LineupsPage() {
  return (
    <>
      <PageHeader title="Мои прогнозы" description="Купоны рассчитываются автоматически после подтверждения статистики." />
      <MyLineups />
    </>
  );
}
