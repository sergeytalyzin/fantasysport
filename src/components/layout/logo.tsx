import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8", className)}>
      <rect width="64" height="64" rx="16" fill="var(--primary)" />
      <path
        d="M22 50V14h12a11 11 0 0 1 0 22h-6"
        stroke="var(--primary-foreground)"
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5", className)} aria-label="PICKUP — на главную">
      <LogoMark />
      <span className="font-display text-lg font-extrabold tracking-tight">
        PICK<span className="text-primary">UP</span>
      </span>
    </Link>
  );
}
