"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signIn } from "@/features/auth/api";
import { type LoginValues, loginSchema } from "@/lib/validations/auth";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signIn(values);
      router.replace(next);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-2xl font-extrabold">Вход</h1>
        <p className="mt-1 text-sm text-muted-foreground">Рады видеть снова!</p>
      </div>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Пароль" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
      </FormField>
      <div className="text-right">
        <Link href="/forgot-password" className="text-xs font-semibold text-primary hover:underline">
          Забыли пароль?
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null} Войти
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Нет аккаунта?{" "}
        <Link href="/register" className="font-semibold text-primary hover:underline">
          Зарегистрируйтесь
        </Link>
      </p>
    </form>
  );
}
