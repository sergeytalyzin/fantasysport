import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Новый пароль" };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
