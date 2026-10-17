import { WifiOff } from "lucide-react";
import { Logo } from "@/components/layout/logo";

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo />
      <WifiOff className="size-10 text-muted-foreground" />
      <h1 className="text-xl font-extrabold">Нет подключения</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        Линии и баланс обновляются только онлайн. Проверьте интернет и обновите страницу.
      </p>
    </div>
  );
}
