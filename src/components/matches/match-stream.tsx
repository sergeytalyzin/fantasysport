"use client";

import { ExternalLink, Play, Tv } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { parseStreamUrl, STREAM_PROVIDER_NAMES } from "@/lib/stream-embed";

const noop = () => () => {};

/**
 * Официальная трансляция матча во встроенном плеере площадки.
 * Плеер загружается по нажатию — iframe не тормозит страницу и не включает звук сам.
 */
export function MatchStream({ url, title }: { url: string | null; title: string }) {
  const [open, setOpen] = useState(false);
  // Домен сайта нужен плееру Twitch; на сервере он неизвестен — плеер появляется после гидратации.
  const hostname = useSyncExternalStore(noop, () => window.location.hostname, () => null);
  const embed = url && hostname ? parseStreamUrl(url, hostname) : null;
  if (!embed) return null;
  const provider = STREAM_PROVIDER_NAMES[embed.provider];

  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-surface-1" aria-label="Трансляция матча">
      <div className="relative aspect-video w-full bg-black">
        {open ? (
          <iframe
            src={embed.embedUrl}
            title={`Трансляция: ${title}`}
            className="absolute inset-0 size-full"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_40%,rgb(212_255_58/0.18),transparent_60%)] text-center"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_40px_-8px_rgb(212_255_58/0.7)] transition-transform duration-200 group-hover:scale-105 sm:size-20">
              <Play className="ml-1 size-7 fill-current sm:size-9" />
            </span>
            <span className="text-sm font-bold">Смотреть трансляцию</span>
            <span className="text-xs text-muted-foreground">Официальный эфир · {provider}</span>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Tv className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">Трансляция идёт с площадки {provider}</span>
        </span>
        <a
          href={embed.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="-my-2 inline-flex shrink-0 items-center gap-1 py-2 font-semibold hover:text-foreground"
        >
          Открыть на {provider} <ExternalLink className="size-3.5" />
        </a>
      </div>
    </section>
  );
}
