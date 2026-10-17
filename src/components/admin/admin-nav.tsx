"use client";

import {
  Activity,
  BadgePercent,
  CalendarDays,
  Gauge,
  type LucideIcon,
  ReceiptText,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Ticket,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Обзор", icon: Gauge },
  { href: "/admin/users", label: "Пользователи", icon: Users },
  { href: "/admin/transactions", label: "Операции", icon: ReceiptText },
  { href: "/admin/matches", label: "События и линии", icon: CalendarDays },
  { href: "/admin/lineups", label: "Прогнозы", icon: Ticket },
  { href: "/admin/payouts", label: "Множители", icon: BadgePercent },
  { href: "/admin/settings", label: "Настройки", icon: Settings },
  { href: "/admin/providers", label: "Спортивные API", icon: Activity },
  { href: "/admin/audit", label: "Аудит", icon: ScrollText },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы админ-панели" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
      <p className="hidden items-center gap-2 px-3 pb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground lg:flex">
        <SlidersHorizontal className="size-3.5" /> Админ-панель
      </p>
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
