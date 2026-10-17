import type { Metadata } from "next";
import { AdminPayouts } from "@/components/admin/admin-payouts";

export const metadata: Metadata = { title: "Множители · Админ" };

export default function Page() {
  return <AdminPayouts />;
}
