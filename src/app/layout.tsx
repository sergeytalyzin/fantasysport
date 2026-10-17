import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PICKUP — прогнозы на статистику спортсменов",
    template: "%s · PICKUP",
  },
  description:
    "Бесплатные прогнозы «Больше/Меньше» на статистику спортсменов КХЛ, НХЛ, РПЛ, АПЛ, Лиги чемпионов и НБА. Виртуальные рубли и рейтинг игроков.",
  applicationName: "PICKUP",
  appleWebApp: { capable: true, title: "PICKUP", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`dark ${manrope.variable} ${unbounded.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
