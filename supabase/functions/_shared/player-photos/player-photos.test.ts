import { describe, expect, it, vi } from "vitest";
import {
  allowedLicense,
  imageAvailable,
  matchingAthletes,
  type PhotoCandidate,
  type PhotoResult,
  type PhotosSink,
  syncPlayerPhotos,
  type WikidataEntity,
} from "./player-photos.ts";

const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } });
const id = (q: string) => claim({ id: q });

// Фрагменты реальных ответов Wikidata (wbgetentities).
const LEBRON: WikidataEntity = {
  labels: { en: { value: "LeBron James" }, ru: { value: "Леброн Джеймс" } },
  claims: { P31: [id("Q5")], P641: [id("Q5372")], P18: [claim("LeBron James (51959977144) (cropped2).jpg")], P3647: [claim("2544")] },
};
const LEBRON_FICTIONAL: WikidataEntity = {
  labels: { en: { value: "LeBron James" } },
  claims: { P31: [id("Q15632617")], P641: [id("Q5372")], P18: [claim("LeBron James Lakers.jpg")] },
};
const MOZYAKIN: WikidataEntity = {
  labels: { en: { value: "Sergei Mozyakin" }, ru: { value: "Сергей Мозякин" } },
  claims: {
    P31: [id("Q5")],
    P641: [id("Q41466")],
    P18: [claim("Sergei Mozyakin 2012-10-08 Amur—Metallurg Magnitogorsk KHL-game.jpeg")],
  },
};

function response(body: BodyInit | null, init: ResponseInit & { url?: string; type?: string } = {}) {
  const res = new Response(body, { status: init.status ?? 200, headers: { "content-type": init.type ?? "application/json" } });
  if (init.url) Object.defineProperty(res, "url", { value: init.url });
  return res;
}
const json = (body: unknown, status = 200) => response(JSON.stringify(body), { status });
const png = (bytes: number[], url?: string) => response(new Uint8Array(bytes), { type: "image/png", url });

describe("matchingAthletes", () => {
  it("берёт только людей нужного вида спорта с тем же именем", () => {
    expect(matchingAthletes([LEBRON, LEBRON_FICTIONAL], "basketball", "LeBron James")).toEqual([LEBRON]);
    expect(matchingAthletes([LEBRON], "hockey", "LeBron James")).toEqual([]);
    expect(matchingAthletes([MOZYAKIN], "hockey", "Сергей Мозякин")).toEqual([MOZYAKIN]);
  });
});

describe("allowedLicense", () => {
  it("пропускает только свободные лицензии с понятной атрибуцией", () => {
    for (const ok of ["cc-by-sa-4.0", "cc-by-sa-3.0", "cc-by-2.0", "cc0", "pd", "pd-self", "pd-usgov"]) expect(allowedLicense(ok)).toBe(true);
    for (const no of ["gfdl", "fal", "cc-by-nc-2.0", "cc-by-nd-4.0", "", undefined]) expect(allowedLicense(no)).toBe(false);
  });
});

describe("imageAvailable", () => {
  it("отсекает перенаправление NHL на заглушку", async () => {
    const f = vi.fn(async () => png([1], "https://assets.nhle.com/mugs/nhl/default-skater.png"));
    expect(await imageAvailable(f as unknown as typeof fetch, "https://assets.nhle.com/mugs/nhl/latest/520x520/1.png")).toBe(false);
  });

  it("отсекает силуэт NBA по хэшу и не путает с настоящим фото", async () => {
    const silhouette = [9, 9, 9];
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(silhouette)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const f1 = vi.fn(async () => png(silhouette));
    expect(await imageAvailable(f1 as unknown as typeof fetch, "https://cdn.nba.com/x.png", hash)).toBe(false);
    const f2 = vi.fn(async () => png([1, 2, 3]));
    expect(await imageAvailable(f2 as unknown as typeof fetch, "https://cdn.nba.com/x.png", hash)).toBe(true);
  });

  it("не считает изображением HTML-страницу и 404", async () => {
    const f1 = vi.fn(async () => response("<html>", { type: "text/html" }));
    expect(await imageAvailable(f1 as unknown as typeof fetch, "https://x/y.png")).toBe(false);
    const f2 = vi.fn(async () => response(null, { status: 404, type: "image/png" }));
    expect(await imageAvailable(f2 as unknown as typeof fetch, "https://x/y.png")).toBe(false);
  });
});

function sink(candidates: PhotoCandidate[]) {
  const saved: PhotoResult[] = [];
  const s: PhotosSink = {
    playersNeedingPhotos: async () => candidates,
    setPlayerPhotos: async (items) => {
      saved.push(...items);
      return items.length;
    },
  };
  return { s, saved };
}

const candidate = (over: Partial<PhotoCandidate>): PhotoCandidate => ({
  player_id: "p",
  sport_id: "hockey",
  full_name: "",
  league_codes: [],
  team_names: [],
  photo_url: null,
  ...over,
});

describe("syncPlayerPhotos", () => {
  it("НХЛ — headshot из ростера команды матча; НБА — по ID из Wikidata; КХЛ — Commons с лицензией", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      if (u.endsWith("/v1/standings/now")) {
        return json({ standings: [
          { teamName: { default: "Tampa Bay Lightning" }, teamAbbrev: { default: "TBL" } },
          { teamName: { default: "Washington Capitals" }, teamAbbrev: { default: "WSH" } },
        ] });
      }
      if (u.endsWith("/v1/roster/TBL/current")) {
        return json({ forwards: [{ id: 8476453, firstName: { default: "Nikita" }, lastName: { default: "Kucherov" }, headshot: "https://assets.nhle.com/mugs/nhl/20262027/TBL/8476453.png", positionCode: "R", sweaterNumber: 86 }], defensemen: [], goalies: [] });
      }
      if (u.endsWith("/v1/roster/WSH/current")) return json({ forwards: [], defensemen: [], goalies: [] });
      if (u.includes("assets.nhle.com/mugs")) return png([1, 2]);
      if (u.includes("wbsearchentities") && u.includes("LeBron")) return json({ search: [{ id: "Q36159" }, { id: "Q108870659" }] });
      if (u.includes("wbsearchentities") && u.includes("Mozyakin")) return json({ search: [{ id: "Q970861" }] });
      if (u.includes("wbgetentities") && u.includes("Q36159")) return json({ entities: { Q36159: LEBRON, Q108870659: LEBRON_FICTIONAL } });
      if (u.includes("wbgetentities") && u.includes("Q970861")) return json({ entities: { Q970861: MOZYAKIN } });
      if (u.endsWith("/1040x760/0.png")) return png([9, 9, 9]);
      if (u.endsWith("/1040x760/2544.png")) return png([7, 7, 7]);
      if (u.includes("commons.wikimedia.org/w/api.php")) {
        return json({ query: { pages: { "1": { imageinfo: [{
          url: "https://upload.wikimedia.org/wikipedia/commons/5/56/M.jpeg",
          thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/M.jpeg/400px-M.jpeg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:M.jpeg",
          extmetadata: {
            License: { value: "cc-by-sa-3.0" },
            LicenseShortName: { value: "CC BY-SA 3.0" },
            LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/3.0" },
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">Александр Головко</a>' },
          },
        }] } } } });
      }
      if (u.includes("upload.wikimedia.org")) return png([5]);
      throw new Error(`unexpected ${u}`);
    });
    const { s, saved } = sink([
      candidate({ player_id: "kuch", full_name: "Nikita Kucherov", league_codes: ["NHL"], team_names: ["Tampa Bay Lightning", "Washington Capitals"], teams: [{ id: "t-wsh", name: "Washington Capitals" }, { id: "t-tbl", name: "Tampa Bay Lightning" }] }),
      candidate({ player_id: "lbj", sport_id: "basketball", full_name: "LeBron James", league_codes: ["NBA"] }),
      candidate({ player_id: "moz", full_name: "Sergei Mozyakin", league_codes: ["KHL"] }),
    ]);
    const report = await syncPlayerPhotos(s, { fetchImpl: fetchImpl as unknown as typeof fetch, wikimediaDelay: 0 });
    expect(saved).toEqual([
      expect.objectContaining({ player_id: "kuch", found: true, photo_source: "nhl", external_player_id: "8476453", photo_url: "https://assets.nhle.com/mugs/nhl/20262027/TBL/8476453.png", team_id: "t-tbl", position: "R", jersey_number: 86 }),
      expect.objectContaining({ player_id: "lbj", found: true, photo_source: "nba", external_player_id: "2544", photo_url: "https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png" }),
      expect.objectContaining({
        player_id: "moz",
        found: true,
        photo_source: "wikimedia",
        photo_license: "CC BY-SA 3.0",
        photo_author: "Александр Головко",
        photo_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/M.jpeg/400px-M.jpeg",
        photo_page_url: "https://commons.wikimedia.org/wiki/File:M.jpeg",
      }),
    ]);
    expect(report).toMatchObject({ checked: 3, found: 3, errors: 0 });
  });

  it("без ключа Sportmonks футбол не запрашивается; несвободная лицензия Commons отклоняется", async () => {
    const BUFFON: WikidataEntity = {
      labels: { en: { value: "Gianluigi Buffon" } },
      claims: { P31: [id("Q5")], P641: [id("Q2736")], P18: [claim("Buffon.jpg")] },
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      if (u.includes("sportmonks")) throw new Error("Sportmonks не должен вызываться без ключа");
      if (u.includes("wbsearchentities")) return json({ search: [{ id: "Q1" }] });
      if (u.includes("wbgetentities")) return json({ entities: { Q1: BUFFON } });
      if (u.includes("commons.wikimedia.org/w/api.php")) {
        return json({ query: { pages: { "1": { imageinfo: [{ url: "https://upload.wikimedia.org/b.jpg", descriptionurl: "d", extmetadata: { License: { value: "cc-by-nc-2.0" } } }] } } } });
      }
      throw new Error(`unexpected ${u}`);
    });
    const { s, saved } = sink([candidate({ player_id: "gb", sport_id: "football", full_name: "Gianluigi Buffon" })]);
    await syncPlayerPhotos(s, { fetchImpl: fetchImpl as unknown as typeof fetch, wikimediaDelay: 0 });
    expect(saved).toEqual([{ player_id: "gb", found: false, keep: false }]);
  });

  it("если источник не подтвердил фото, доступное прежнее остаётся, недоступное очищается", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const u = String(input);
      if (u.includes("wbsearchentities")) return json({ search: [] });
      if (u === "https://ok/1.png") return png([1]);
      if (u === "https://gone/1.png") return response(null, { status: 404, type: "image/png" });
      throw new Error(`unexpected ${u}`);
    });
    const { s, saved } = sink([
      candidate({ player_id: "a", full_name: "A B", photo_url: "https://ok/1.png" }),
      candidate({ player_id: "b", full_name: "C D", photo_url: "https://gone/1.png" }),
    ]);
    await syncPlayerPhotos(s, { fetchImpl: fetchImpl as unknown as typeof fetch, wikimediaDelay: 0 });
    expect(saved).toEqual([
      { player_id: "a", found: false, keep: true },
      { player_id: "b", found: false, keep: false },
    ]);
  });
});
