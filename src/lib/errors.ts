// Ошибки RPC приходят из PostgreSQL уже на русском (message) с кодом в hint.

export interface AppError {
  message: string;
  code: string | null;
}

interface PostgrestLikeError {
  message?: string;
  hint?: string | null;
  code?: string;
}

const FALLBACKS: Record<string, string> = {
  "42501": "Недостаточно прав для этого действия",
  PGRST301: "Сессия истекла — войдите снова",
  "Failed to fetch": "Нет соединения с сервером",
};

export function toAppError(error: unknown): AppError {
  if (error && typeof error === "object") {
    const e = error as PostgrestLikeError;
    const code = e.hint && /^[A-Z_]+$/.test(e.hint) ? e.hint : (e.code ?? null);
    const isBusiness = e.code === "P0001" || (e.hint && /^[A-Z_]+$/.test(e.hint));
    if (isBusiness && e.message) return { message: e.message, code };
    if (e.code && FALLBACKS[e.code]) return { message: FALLBACKS[e.code], code };
    if (e.message && FALLBACKS[e.message]) return { message: FALLBACKS[e.message], code };
    if (e.message) return { message: e.message, code };
  }
  return { message: "Что-то пошло не так. Попробуйте ещё раз", code: null };
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

/** Бросает ошибку Supabase как исключение для TanStack Query. */
export function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}
