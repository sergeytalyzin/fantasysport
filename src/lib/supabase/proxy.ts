import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

const PROTECTED_PREFIXES = ["/lineups", "/profile", "/wallet", "/admin"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password"];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Обновляет сессию Supabase и выполняет оптимистичную проверку доступа.
 * Окончательная проверка прав — в БД (RLS и проверки внутри RPC).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const path = request.nextUrl.pathname;

  const redirect = (pathname: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = params ? new URLSearchParams(params).toString() : "";
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };

  if (!userId && matches(path, PROTECTED_PREFIXES)) {
    return redirect("/login", { next: path });
  }
  if (userId && matches(path, AUTH_PAGES)) {
    return redirect("/");
  }
  if (userId && matches(path, ["/admin"])) {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (isAdmin !== true) return redirect("/");
  }
  return response;
}
