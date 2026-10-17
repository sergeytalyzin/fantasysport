import type { Metadata } from "next";
import { AdminAudit } from "@/components/admin/admin-audit";

export const metadata: Metadata = { title: "Аудит · Админ" };

export default function Page() {
  return <AdminAudit />;
}
