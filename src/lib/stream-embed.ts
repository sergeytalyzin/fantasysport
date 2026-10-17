// Встраивание официальных трансляций. Поддерживаются только площадки, которые сами
// дают встраиваемый плеер: YouTube, Twitch, VK Видео, Rutube. Ссылку вносит
// администратор; тот же список доменов проверяется в admin_set_match_stream.

export type StreamProvider = "youtube" | "twitch" | "vk" | "rutube";

export interface StreamEmbed {
  provider: StreamProvider;
  /** Адрес для iframe. */
  embedUrl: string;
  /** Исходная страница трансляции. */
  pageUrl: string;
}

export const STREAM_PROVIDER_NAMES: Record<StreamProvider, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  vk: "VK Видео",
  rutube: "Rutube",
};

const YOUTUBE_ID = /^[\w-]{11}$/;

/**
 * Ссылка на трансляцию → адрес встраиваемого плеера; null — площадка не поддерживается.
 * `parent` — домен сайта (Twitch требует его в адресе плеера).
 */
export function parseStreamUrl(raw: string, parent: string): StreamEmbed | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^(www|m)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const pageUrl = url.toString();

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    // Прямой эфир канала: /channel/{id}/live.
    if (parts[0] === "channel" && parts[1] && parts[2] === "live") {
      return { provider: "youtube", pageUrl, embedUrl: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(parts[1])}` };
    }
    const id =
      host === "youtu.be"
        ? parts[0]
        : parts[0] === "watch"
          ? url.searchParams.get("v")
          : ["live", "embed", "shorts"].includes(parts[0])
            ? parts[1]
            : null;
    return id && YOUTUBE_ID.test(id)
      ? { provider: "youtube", pageUrl, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0` }
      : null;
  }

  if (host === "twitch.tv" || host === "player.twitch.tv") {
    const p = new URLSearchParams({ parent, autoplay: "true" });
    if (host === "player.twitch.tv") {
      const channel = url.searchParams.get("channel");
      const video = url.searchParams.get("video");
      if (channel) p.set("channel", channel);
      else if (video) p.set("video", video);
      else return null;
    } else if (parts[0] === "videos" && /^\d+$/.test(parts[1] ?? "")) {
      p.set("video", `v${parts[1]}`);
    } else if (parts.length === 1 && /^\w{3,25}$/.test(parts[0])) {
      p.set("channel", parts[0]);
    } else {
      return null;
    }
    return { provider: "twitch", pageUrl, embedUrl: `https://player.twitch.tv/?${p}` };
  }

  if (host === "vkvideo.ru" || host === "vk.com" || host === "vk.ru") {
    // Готовый адрес плеера (с hash для видео с ограниченным встраиванием).
    if (parts[0] === "video_ext.php") {
      const oid = url.searchParams.get("oid");
      const id = url.searchParams.get("id");
      if (!oid || !id || !/^-?\d+$/.test(oid) || !/^\d+$/.test(id)) return null;
      const p = new URLSearchParams({ oid, id, hd: "2" });
      const hash = url.searchParams.get("hash");
      if (hash) p.set("hash", hash);
      return { provider: "vk", pageUrl, embedUrl: `https://vkvideo.ru/video_ext.php?${p}` };
    }
    const m = /^video(-?\d+)_(\d+)$/.exec(parts[parts.length - 1] ?? "") ?? /^video(-?\d+)_(\d+)$/.exec(url.searchParams.get("z") ?? "");
    return m ? { provider: "vk", pageUrl, embedUrl: `https://vkvideo.ru/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2` } : null;
  }

  if (host === "rutube.ru") {
    // /video/{id}/, /live/video/{id}/, /play/embed/{id}
    const id = parts[parts.length - 1];
    const ok = (parts[0] === "video" || (parts[0] === "live" && parts[1] === "video") || (parts[0] === "play" && parts[1] === "embed")) && /^[a-f0-9]{32}$/i.test(id ?? "");
    return ok ? { provider: "rutube", pageUrl, embedUrl: `https://rutube.ru/play/embed/${id}` } : null;
  }

  return null;
}
