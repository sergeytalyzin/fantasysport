"use client";

import { useSearchParams } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export function LoginFormWithRedirect() {
  const params = useSearchParams();
  return <LoginForm next={safeRedirectPath(params.get("next"))} />;
}
