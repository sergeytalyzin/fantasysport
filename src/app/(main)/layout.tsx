import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SetupNotice } from "@/components/layout/setup-notice";

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppHeader />
      <SetupNotice />
      <main className="mx-auto w-full max-w-7xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-5 lg:px-6 lg:pb-12 lg:pt-8">{children}</main>
      <BottomNav />
    </>
  );
}
