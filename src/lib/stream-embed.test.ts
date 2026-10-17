import { describe, expect, it } from "vitest";
import { parseStreamUrl } from "./stream-embed";

const P = "pickup.example";

describe("parseStreamUrl", () => {
  it("YouTube: видео, короткая ссылка, эфир, эфир канала", () => {
    expect(parseStreamUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", P)?.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
    expect(parseStreamUrl("https://youtu.be/dQw4w9WgXcQ", P)?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
    expect(parseStreamUrl("https://m.youtube.com/live/dQw4w9WgXcQ", P)?.provider).toBe("youtube");
    expect(parseStreamUrl("https://www.youtube.com/channel/UC4R8DWoMoI7CAwX8_LjQHig/live", P)?.embedUrl).toBe(
      "https://www.youtube.com/embed/live_stream?channel=UC4R8DWoMoI7CAwX8_LjQHig",
    );
  });

  it("Twitch: канал и запись, с доменом сайта в parent", () => {
    expect(parseStreamUrl("https://www.twitch.tv/esl_dota2", P)?.embedUrl).toBe(
      `https://player.twitch.tv/?parent=${P}&autoplay=true&channel=esl_dota2`,
    );
    expect(parseStreamUrl("https://www.twitch.tv/videos/123456789", P)?.embedUrl).toBe(
      `https://player.twitch.tv/?parent=${P}&autoplay=true&video=v123456789`,
    );
  });

  it("VK Видео: страница видео и готовый адрес плеера с hash", () => {
    expect(parseStreamUrl("https://vkvideo.ru/video-221016489_456239917", P)?.embedUrl).toBe(
      "https://vkvideo.ru/video_ext.php?oid=-221016489&id=456239917&hd=2",
    );
    expect(parseStreamUrl("https://vk.com/video_ext.php?oid=-1&id=2&hash=abc", P)?.embedUrl).toBe(
      "https://vkvideo.ru/video_ext.php?oid=-1&id=2&hd=2&hash=abc",
    );
  });

  it("Rutube: видео и эфир", () => {
    const id = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    expect(parseStreamUrl(`https://rutube.ru/video/${id}/`, P)?.embedUrl).toBe(`https://rutube.ru/play/embed/${id}`);
    expect(parseStreamUrl(`https://rutube.ru/live/video/${id}/`, P)?.provider).toBe("rutube");
  });

  it("отклоняет другие сайты, http и некорректные ссылки", () => {
    for (const bad of [
      "https://example.com/stream.m3u8",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=bad",
      "https://evil-youtube.com/watch?v=dQw4w9WgXcQ",
      "https://twitch.tv/a/b/c",
      "не ссылка",
    ]) {
      expect(parseStreamUrl(bad, P)).toBeNull();
    }
  });
});
