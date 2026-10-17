import type { Metadata } from "next";
import { AdminLineups } from "@/components/admin/admin-lineups";

export const metadata: Metadata = { title: "Прогнозы · Админ" };

export default function Page() {
  return <AdminLineups />;
}
