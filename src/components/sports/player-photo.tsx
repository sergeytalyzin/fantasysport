import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Фото спортсмена. Если провайдер не дал фото,
 * показываем силуэт в цветах команды с номером.
 */
export function PlayerPhoto({
  name,
  photoUrl,
  teamColor,
  number,
  className,
}: {
  name: string;
  photoUrl: string | null;
  teamColor: string | null;
  number?: number | null;
  className?: string;
}) {
  const color = teamColor ?? "#7c8cff";
  return (
    <div
      className={cn("relative isolate size-16 shrink-0 overflow-hidden rounded-2xl", className)}
      style={{ background: `linear-gradient(160deg, ${color} 0%, color-mix(in oklab, ${color} 35%, #07090d) 100%)` }}
    >
      {photoUrl ? (
        <Image src={photoUrl} alt={name} fill sizes="80px" className="object-cover object-top" />
      ) : (
        <>
          <span className="absolute right-1.5 top-1 font-display text-[0.65rem] font-bold text-white/55">
            {number ?? ""}
          </span>
          <svg viewBox="0 0 64 64" className="absolute inset-x-0 bottom-0 mx-auto w-[86%] text-black/35" aria-hidden>
            <circle cx="32" cy="22" r="12" fill="currentColor" />
            <path d="M8 64c2-14 12-22 24-22s22 8 24 22z" fill="currentColor" />
          </svg>
        </>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15" />
    </div>
  );
}
