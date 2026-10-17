"use client";

import Image from "next/image";
import { useState } from "react";
import { type PhotoCredit, photoCreditText } from "@/lib/photo-credit";
import { cn } from "@/lib/utils";

/**
 * Фото спортсмена. Если фото нет или оно не загрузилось,
 * показываем силуэт в цветах команды с номером.
 */
export function PlayerPhoto({
  name,
  photoUrl,
  teamColor,
  number,
  credit,
  showCredit = false,
  className,
}: {
  name: string;
  photoUrl: string | null;
  teamColor: string | null;
  number?: number | null;
  /** Источник и лицензия фото — подпись при наведении. */
  credit?: PhotoCredit | null;
  /** Ссылка на страницу файла с автором и лицензией (для фото Wikimedia Commons). */
  showCredit?: boolean;
  className?: string;
}) {
  const color = teamColor ?? "#7c8cff";
  const [failed, setFailed] = useState<string | null>(null);
  const src = photoUrl && failed !== photoUrl ? photoUrl : null;
  const creditText = src ? photoCreditText(credit) : null;

  return (
    <div
      className={cn("relative isolate size-16 shrink-0 overflow-hidden rounded-2xl", className)}
      style={{ background: `linear-gradient(160deg, ${color} 0%, color-mix(in oklab, ${color} 35%, #07090d) 100%)` }}
      title={creditText ?? undefined}
    >
      {src ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes="96px"
          className="object-cover object-top"
          onError={() => setFailed(src)}
        />
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
      {showCredit && creditText && credit?.photo_page_url ? (
        <a
          href={credit.photo_page_url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-0.5 right-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-black/55 text-[0.55rem] font-bold text-white/85 hover:bg-black/80"
          aria-label={creditText}
        >
          ©
        </a>
      ) : null}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15" />
    </div>
  );
}
