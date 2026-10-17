import type { Metadata } from "next";
import { AdminProviders } from "@/components/admin/admin-providers";

export const metadata: Metadata = { title: "Спортивные API · Админ" };

export default function Page() {
  return <AdminProviders />;
}
