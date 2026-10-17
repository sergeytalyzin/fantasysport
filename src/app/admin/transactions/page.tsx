import type { Metadata } from "next";
import { AdminTransactions } from "@/components/admin/admin-transactions";

export const metadata: Metadata = { title: "Операции · Админ" };

export default function Page() {
  return <AdminTransactions />;
}
