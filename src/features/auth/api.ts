"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ForgotPasswordValues, LoginValues, RegisterValues, ResetPasswordValues } from "@/lib/validations/auth";

const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: "Неверный email или пароль",
  email_not_confirmed: "Подтвердите email — ссылка отправлена на почту",
  user_already_exists: "Пользователь с таким email уже зарегистрирован",
  weak_password: "Слишком простой пароль",
  over_email_send_rate_limit: "Слишком много писем. Попробуйте позже",
  over_request_rate_limit: "Слишком много попыток. Попробуйте позже",
  same_password: "Новый пароль совпадает со старым",
};

function authError(error: { code?: string; message: string }): Error {
  return new Error((error.code && AUTH_ERRORS[error.code]) || error.message);
}

const callbackUrl = (next: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

export async function signIn({ email, password }: LoginValues) {
  const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
  if (error) throw authError(error);
}

/** Возвращает true, если требуется подтверждение email. */
export async function signUp({ email, password, nickname }: RegisterValues): Promise<boolean> {
  const { data, error } = await getSupabaseBrowserClient().auth.signUp({
    email,
    password,
    options: { data: { nickname }, emailRedirectTo: callbackUrl("/") },
  });
  if (error) throw authError(error);
  return !data.session;
}

export async function signOut() {
  await getSupabaseBrowserClient().auth.signOut();
}

export async function requestPasswordReset({ email }: ForgotPasswordValues) {
  const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
    redirectTo: callbackUrl("/reset-password"),
  });
  if (error) throw authError(error);
}

export async function updatePassword({ password }: ResetPasswordValues) {
  const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
  if (error) throw authError(error);
}
