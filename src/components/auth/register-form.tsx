"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Gift, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signUp } from "@/features/auth/api";
import { type RegisterValues, registerSchema } from "@/lib/validations/auth";

export function RegisterForm() {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { nickname: "", email: "", password: "", confirmPassword: "", acceptRules: false as unknown as true },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const needsConfirmation = await signUp(values);
      if (needsConfirmation) {
        setSentTo(values.email);
      } else {
        toast.success("Добро пожаловать! На ваш счёт зачислено 100 000 ₽");
        router.replace("/");
        router.refresh();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  if (sentTo) {
    return (
      <div className="space-y-3 text-center">
        <MailCheck className="mx-auto size-12 text-primary" />
        <h1 className="text-xl font-extrabold">Проверьте почту</h1>
        <p className="text-sm text-muted-foreground">
          Мы отправили ссылку для подтверждения на <b className="text-foreground">{sentTo}</b>. После подтверждения на
          счёт поступят 100 000 ₽.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-2xl font-extrabold">Регистрация</h1>
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
          <Gift className="size-4 shrink-0" /> 100 000 ₽ на старте и ещё 100 000 ₽ каждый месяц
        </p>
      </div>
      <FormField id="nickname" label="Никнейм" error={errors.nickname?.message} hint="Будет виден в рейтинге">
        <Input id="nickname" autoComplete="nickname" {...form.register("nickname")} />
      </FormField>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Пароль" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <FormField id="confirmPassword" label="Повторите пароль" error={errors.confirmPassword?.message}>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
      </FormField>
      <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("acceptRules")} />
        <span>
          Мне есть 18 лет. Я понимаю, что PICKUP — игра на виртуальные рубли без реальных денежных выплат.
        </span>
      </label>
      {errors.acceptRules ? <p className="text-xs font-medium text-destructive">{errors.acceptRules.message}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null} Создать аккаунт
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Войти
        </Link>
      </p>
    </form>
  );
}
