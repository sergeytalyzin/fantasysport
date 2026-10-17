"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/features/auth/auth-provider";
import { RealtimeSync } from "@/features/wallet/realtime-sync";
import { useCouponStore } from "@/stores/coupon-store";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
          mutations: { retry: 0 },
        },
      }),
  );

  useEffect(() => {
    void useCouponStore.persist.rehydrate();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeSync />
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          richColors
          toastOptions={{ classNames: { toast: "!rounded-2xl !border-white/10 !bg-surface-2 !font-sans" } }}
        />
      </AuthProvider>
    </QueryClientProvider>
  );
}
