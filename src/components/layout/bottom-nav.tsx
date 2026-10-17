"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { isActivePath, NAV_ITEMS } from "./nav-items";

function BottomNavLinks({ pathname }: { pathname: string }) {
  return (
    <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 lg:hidden" aria-label="Основная навигация">
      <ul className="mx-auto grid max-w-lg grid-cols-5 px-2 pt-1.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl py-1.5 text-[0.65rem] font-semibold transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className={cn("size-5 transition-transform", active && "scale-110")} strokeWidth={active ? 2.4 : 1.8} />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ActiveBottomNav() {
  return <BottomNavLinks pathname={usePathname()} />;
}

/** Путь — данные запроса (динамические маршруты), поэтому подсветка внутри Suspense. */
export function BottomNav() {
  return (
    <Suspense fallback={<BottomNavLinks pathname="" />}>
      <ActiveBottomNav />
    </Suspense>
  );
}
