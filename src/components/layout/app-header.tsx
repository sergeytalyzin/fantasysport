"use client";

import { LogIn, LogOut, Shield, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/features/auth/api";
import { useAuth } from "@/features/auth/auth-provider";
import { useProfileSummary } from "@/features/profile/hooks";
import { useWallet } from "@/features/wallet/hooks";
import { formatRub } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { isActivePath, NAV_ITEMS } from "./nav-items";
import { UserAvatar } from "./user-avatar";

function BalanceChip() {
  const { data: wallet, isLoading } = useWallet();
  if (isLoading || !wallet) return <Skeleton className="h-9 w-28" />;
  return (
    <Link
      href="/wallet"
      className="flex h-9 items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 text-sm font-bold text-primary transition-colors hover:bg-primary/15"
      aria-label="Баланс"
    >
      <Wallet className="size-4" />
      <span className="numeric">{formatRub(wallet.balance)}</span>
    </Link>
  );
}

function UserMenu() {
  const router = useRouter();
  const { data: profile } = useProfileSummary();
  if (!profile) return <Skeleton className="size-9 rounded-full" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Меню профиля">
        <UserAvatar nickname={profile.nickname} url={profile.avatar_url} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="font-semibold">{profile.nickname}</div>
          <div className="text-xs font-normal text-muted-foreground">Место в рейтинге: {profile.overall_rank}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserRound /> Профиль
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/wallet")}>
          <Wallet /> Кошелёк
        </DropdownMenuItem>
        {profile.role === "admin" ? (
          <DropdownMenuItem onClick={() => router.push("/admin")}>
            <Shield /> Админ-панель
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await signOut();
            router.push("/");
            router.refresh();
          }}
        >
          <LogOut /> Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppHeader() {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  return (
    <header className="glass sticky top-0 z-40 border-x-0 border-t-0">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 lg:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Разделы">
          {NAV_ITEMS.slice(0, 3).map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
                isActivePath(pathname, href) ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          {isLoading ? (
            <Skeleton className="h-9 w-28" />
          ) : user ? (
            <>
              <BalanceChip />
              <UserMenu />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/login">Войти</Link>
              </Button>
              <Button asChild>
                <Link href="/register">
                  <LogIn /> Регистрация
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
