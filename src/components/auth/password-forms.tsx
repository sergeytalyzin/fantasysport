"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, updatePassword } from "@/features/auth/api";
import {
  type ForgotPasswordValues,
  forgotPasswordSchema,
  type ResetPasswordValues,
  resetPasswordSchema,
} from "@/lib/validations/auth";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await requestPasswordReset(values);
      setSent(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  if (sent) {
    return (
      <div className="space-y-3 text-center">
        <MailCheck className="mx-auto size-12 text-primary" />
        <h1 className="text-xl font-extrabold">Письмо отправлено</h1>
        <p className="text-sm text-muted-foreground">Перейдите по ссылке из письма, чтобы задать новый пароль.</p>
        <Link href="/login" className="inline-block text-sm font-semibold text-primary hover:underline">
          Вернуться ко входу
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-2xl font-extrabold">Восстановление</h1>
        <p className="mt-1 text-sm text-muted-foreground">Отправим ссылку для смены пароля.</p>
      </div>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null} Отправить ссылку
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="-my-3 inline-block py-3 font-semibold text-primary hover:underline">
          Вспомнили пароль?
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updatePassword(values);
      toast.success("Пароль обновлён");
      router.replace("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-2xl font-extrabold">Новый пароль</h1>
        <p className="mt-1 text-sm text-muted-foreground">Придумайте пароль не короче 8 символов.</p>
      </div>
      <FormField id="password" label="Новый пароль" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <FormField id="confirmPassword" label="Повторите пароль" error={errors.confirmPassword?.message}>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null} Сохранить пароль
      </Button>
    </form>
  );
}
