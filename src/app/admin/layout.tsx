import { AdminNav } from "@/components/admin/admin-nav";
import { AppHeader } from "@/components/layout/app-header";

// Доступ: proxy.ts (оптимистичная проверка) + проверка роли в каждой admin_* RPC и RLS.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <AppHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:flex-row lg:gap-8 lg:px-6 lg:py-8">
        <aside className="lg:sticky lg:top-24 lg:w-56 lg:shrink-0 lg:self-start">
          <AdminNav />
        </aside>
        <main className="min-w-0 flex-1 space-y-5">{children}</main>
      </div>
    </>
  );
}
