import type { Metadata } from "next";
import { AdminUsers } from "@/components/admin/admin-users";

export const metadata: Metadata = { title: "Пользователи · Админ" };

export default function Page() {
  return <AdminUsers />;
}
