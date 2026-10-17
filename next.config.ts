import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Фото спортсменов и аватары из Supabase Storage.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      ...(supabaseHost ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }] : []),
      { protocol: "http", hostname: "127.0.0.1", port: "54321", pathname: "/storage/v1/object/public/**" },
      // Логотипы команд (см. supabase/functions/_shared/team-logos).
      { protocol: "https", hostname: "assets.nhle.com", pathname: "/logos/**" },
      { protocol: "https", hostname: "r2.thesportsdb.com", pathname: "/images/**" },
      { protocol: "https", hostname: "www.thesportsdb.com", pathname: "/images/**" },
      { protocol: "https", hostname: "commons.wikimedia.org", pathname: "/wiki/Special:FilePath/**" },
      { protocol: "https", hostname: "cdn.steamusercontent.com" },
      { protocol: "https", hostname: "cloud-3.steamusercontent.com" },
      { protocol: "https", hostname: "steamusercontent-a.akamaihd.net" },
      { protocol: "https", hostname: "steamcdn-a.akamaihd.net" },
      // Фото спортсменов (см. supabase/functions/_shared/player-photos).
      { protocol: "https", hostname: "assets.nhle.com", pathname: "/mugs/**" },
      { protocol: "https", hostname: "cdn.nba.com", pathname: "/headshots/**" },
      { protocol: "https", hostname: "cdn.sportmonks.com", pathname: "/images/**" },
      { protocol: "https", hostname: "upload.wikimedia.org", pathname: "/wikipedia/commons/**" },
      { protocol: "https", hostname: "thumb.wikimedia.org", pathname: "/wikipedia/commons/**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
