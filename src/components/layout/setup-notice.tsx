import { isSupabaseConfigured } from "@/lib/env";

/** Подсказка разработчику, если переменные Supabase не заданы. */
export function SetupNotice() {
  if (isSupabaseConfigured) return null;
  return (
    <div className="border-b border-gold/30 bg-gold/10 px-4 py-2.5 text-center text-sm text-gold">
      Supabase не подключён: задайте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY в .env.local (см. README).
    </div>
  );
}
