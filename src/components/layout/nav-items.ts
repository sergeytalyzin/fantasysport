import { LayoutGrid, type LucideIcon, Ticket, Trophy, UserRound, Wallet } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Линии", icon: LayoutGrid },
  { href: "/lineups", label: "Мои прогнозы", icon: Ticket },
  { href: "/leaderboard", label: "Рейтинг", icon: Trophy },
  { href: "/wallet", label: "Кошелёк", icon: Wallet },
  { href: "/profile", label: "Профиль", icon: UserRound },
];

export const isActivePath = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
