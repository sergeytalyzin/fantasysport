import { Logo } from "@/components/layout/logo";
import { SetupNotice } from "@/components/layout/setup-notice";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SetupNotice />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <Logo className="mb-8" />
        <div className="w-full max-w-sm rounded-3xl border border-white/[0.07] bg-surface-1 p-6 shadow-2xl shadow-black/40 sm:p-8">
          {children}
        </div>
        <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
          PICKUP — бесплатная игра на виртуальные рубли. Реальные деньги не принимаются и не выплачиваются.
        </p>
      </div>
    </div>
  );
}
