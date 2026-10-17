import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginFormWithRedirect } from "@/components/auth/login-form-with-redirect";

export const metadata: Metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginFormWithRedirect />
    </Suspense>
  );
}
