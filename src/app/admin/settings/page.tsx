import type { Metadata } from "next";
import { AdminSettings } from "@/components/admin/admin-settings";

export const metadata: Metadata = { title: "Настройки · Админ" };

export default function Page() {
  return <AdminSettings />;
}
