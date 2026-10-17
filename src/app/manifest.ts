import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PICKUP — прогнозы на спорт",
    short_name: "PICKUP",
    description: "Прогнозы «Больше/Меньше» на статистику спортсменов с виртуальными рублями",
    lang: "ru",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07090d",
    theme_color: "#07090d",
    categories: ["sports", "games", "entertainment"],
    icons: [
      { src: "/pwa-icons/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icons/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
