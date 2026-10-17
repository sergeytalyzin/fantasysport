import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ProfileView } from "@/components/profile/profile-view";

export const metadata: Metadata = { title: "Профиль" };

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Профиль" />
      <ProfileView />
    </div>
  );
}
