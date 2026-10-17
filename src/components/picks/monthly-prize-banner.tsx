import { ArrowRight, Crown, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";

/** Иллюстрация смартфона (без чужих логотипов и фотографий): титановая рамка, экран с подсветкой. */
function PhoneArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 240" className={className} aria-hidden>
      <defs>
        <linearGradient id="prize-frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a8f99" />
          <stop offset="0.45" stopColor="#3b4049" />
          <stop offset="1" stopColor="#a7acb5" />
        </linearGradient>
        <linearGradient id="prize-screen" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#1b2a12" />
          <stop offset="0.55" stopColor="#0b0f14" />
          <stop offset="1" stopColor="#3a2a08" />
        </linearGradient>
        <radialGradient id="prize-glow" cx="0.5" cy="0.42" r="0.5">
          <stop offset="0" stopColor="#d4ff3a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#d4ff3a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="prize-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe48a" />
          <stop offset="0.5" stopColor="#ffc83d" />
          <stop offset="1" stopColor="#c98a12" />
        </linearGradient>
      </defs>
      {/* Корпус и экран */}
      <rect x="4" y="4" width="112" height="232" rx="22" fill="url(#prize-frame)" />
      <rect x="8" y="8" width="104" height="224" rx="18" fill="#05070a" />
      <rect x="11" y="11" width="98" height="218" rx="15.5" fill="url(#prize-screen)" />
      <rect x="11" y="11" width="98" height="218" rx="15.5" fill="url(#prize-glow)" />
      {/* Вырез с камерой */}
      <rect x="44" y="18" width="32" height="9" rx="4.5" fill="#000" />
      {/* «№1» на экране */}
      <text x="60" y="118" textAnchor="middle" fontSize="40" fontWeight="800" fill="url(#prize-gold)" fontFamily="system-ui, sans-serif">
        №1
      </text>
      <rect x="34" y="134" width="52" height="5" rx="2.5" fill="#d4ff3a" opacity="0.85" />
      <rect x="42" y="145" width="36" height="4" rx="2" fill="#ffffff" opacity="0.25" />
      {/* Кнопки на рамке */}
      <rect x="0" y="62" width="3" height="18" rx="1.5" fill="#6b707a" />
      <rect x="0" y="88" width="3" height="28" rx="1.5" fill="#6b707a" />
      <rect x="117" y="78" width="3" height="34" rx="1.5" fill="#6b707a" />
      {/* Блик на стекле */}
      <path d="M14 30 L60 14 L36 14 Z" fill="#fff" opacity="0.06" />
    </svg>
  );
}

/** Промо ежемесячного конкурса: первое место рейтинга месяца получает iPhone 18 Pro. */
export function MonthlyPrizeBanner() {
  return (
    <section
      aria-labelledby="monthly-prize-title"
      className="group relative isolate overflow-hidden rounded-3xl border border-gold/30 bg-surface-1 p-5 sm:p-7"
    >
      {/* Свечение и фон */}
      <div
        className="pointer-events-none absolute -right-16 -top-20 -z-10 size-72 rounded-full bg-gold/25 blur-3xl transition-opacity duration-500 group-hover:opacity-90 sm:size-96"
        aria-hidden
      />
      <div className="pointer-events-none absolute -bottom-28 -left-16 -z-10 size-64 rounded-full bg-primary/15 blur-3xl" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "18px 18px" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent"
        aria-hidden
      />

      <div className="flex flex-col-reverse items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-gold">
            <Sparkles className="size-3.5" /> Конкурс месяца
          </p>
          <h2
            id="monthly-prize-title"
            className="mt-3 text-balance text-xl font-extrabold leading-tight sm:text-3xl landscape:max-lg:text-xl"
          >
            Стань <span className="text-gold">№1</span> в рейтинге месяца и выиграй{" "}
            <span
              className="motion-safe:animate-shimmer bg-[linear-gradient(110deg,#ffc83d_20%,#fff6d6_40%,#d4ff3a_55%,#ffc83d_75%)] bg-[length:200%_100%] bg-clip-text text-transparent"
            >
              iPhone 18 Pro!
            </span>
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground sm:mx-0">
            Игрок, занявший первое место в рейтинге по итогам месяца, получает главный приз — iPhone 18 Pro.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/leaderboard"
              className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-gradient-to-r from-gold to-primary px-6 text-sm font-extrabold text-primary-foreground shadow-[0_10px_30px_-10px_rgb(255_200_61/0.7)] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_36px_-10px_rgb(255_200_61/0.85)] active:translate-y-0 sm:w-auto"
            >
              Смотреть рейтинг
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Crown className="size-4 text-gold" /> Победитель — по итогам месяца
            </span>
          </div>
        </div>

        {/* Приз: смартфон и кубок */}
        <div className="relative mt-2 flex h-36 w-40 shrink-0 items-center justify-center sm:mt-0 sm:h-52 sm:w-56" aria-hidden>
          <div className="absolute size-36 rounded-full bg-gold/30 blur-2xl motion-safe:animate-pulse sm:size-44" />
          <PhoneArt className="relative h-full w-auto -rotate-6 drop-shadow-[0_20px_30px_rgba(0,0,0,0.6)] motion-safe:animate-float" />
          <div className="absolute -bottom-1 left-0 flex size-14 items-center justify-center rounded-2xl border border-gold/40 bg-gradient-to-br from-[#ffe48a] via-gold to-[#c98a12] shadow-[0_10px_30px_-6px_rgb(255_200_61/0.7)] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 sm:size-20">
            <Trophy className="size-8 text-[#3a2a08] sm:size-11" strokeWidth={2.2} />
          </div>
        </div>
      </div>
    </section>
  );
}
