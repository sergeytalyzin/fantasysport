import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { TransactionList } from "@/components/wallet/transaction-list";
import { WalletOverview } from "@/components/wallet/wallet-overview";

export const metadata: Metadata = { title: "Кошелёк" };

export default function WalletPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Кошелёк" description="Только виртуальные рубли: без депозитов, выводов и конвертации." />
      <WalletOverview />
      <section className="space-y-3">
        <h2 className="text-lg font-bold">История операций</h2>
        <TransactionList />
      </section>
    </div>
  );
}
