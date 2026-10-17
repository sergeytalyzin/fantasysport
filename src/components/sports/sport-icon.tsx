import type { SportId } from "@/types/domain";

/** Простые собственные иконки видов спорта (в lucide нет хоккея). */
export function SportIcon({ sport, className = "size-4" }: { sport: SportId | "all"; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (sport) {
    case "hockey":
      return (
        <svg {...common}>
          <path d="M4 3l7 13h6a2 2 0 0 1 0 4H9.5a2 2 0 0 1-1.8-1.1L2.5 8" />
          <ellipse cx="19" cy="7" rx="3" ry="1.4" />
        </svg>
      );
    case "football":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7l4 3-1.5 4.5h-5L8 10z" />
          <path d="M12 3v4M21 10l-5 0M3 10h5M7 20l2.5-5.5M17 20l-2.5-5.5" />
        </svg>
      );
    case "basketball":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3v18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <rect x="14" y="14" width="7" height="7" rx="2" />
        </svg>
      );
  }
}
