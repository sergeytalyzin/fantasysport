import type { Metadata } from "next";
import { AdminMatches } from "@/components/admin/admin-matches";

export const metadata: Metadata = { title: "События и линии · Админ" };

export default function Page() {
  return <AdminMatches />;
}
