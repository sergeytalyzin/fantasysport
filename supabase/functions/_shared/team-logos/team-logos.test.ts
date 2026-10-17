import { describe, expect, it, vi } from "vitest";
import {
  type LogoCandidate,
  type LogoResult,
  type LogosSink,
  pickSportsDbBadge,
  pickWikidataLogo,
  strippedQuery,
  syncTeamLogos,
  teamKey,
  type WikidataEntity,
} from "./team-logos.ts";

// Фрагменты реальных ответов TheSportsDB (searchteams.php, бесплатный ключ).
const ZENIT_VOLLEY = {
  strTeam: "Zenit St Petersburg",
  strTeamAlternate: "VC Zenit Saint Petersburg, Волейбольная команда «Зенит»",
  strSport: "Volleyball",
  strBadge: "https://r2.thesportsdb.com/images/media/team/badge/v.png",
};
const ZENIT_FOOTBALL = {
  strTeam: "Zenit Saint Petersburg",
  strTeamAlternate: "Football Club Zenit, Футбольный клуб «Зенит»",
  strSport: "Soccer",
  strBadge: "https://r2.thesportsdb.com/images/media/team/badge/f.png",
};
const IZHEVSK = { strTeam: "Izhevsk", strTeamAlternate: "ФК «Ижевск», FC Zenit-Izhevsk", strSport: "Soccer", strBadge: "https://x/i.png" };

// Фрагменты реальных ответов Wikidata (wbgetentities).
const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } });
const TAMPA: WikidataEntity = {
  labels: { en: { value: "Tampa Bay Lightning" }, ru: { value: "Тампа-Бэй Лайтнинг" } },
  claims: { P641: [claim({ id: "Q41466" })], P154: [claim("Tampa Bay Lightning 2011.svg")] },
};
const TAMPA_SEASON: WikidataEntity = {
  labels: { en: { value: "2014–15 Tampa Bay Lightning season" }, ru: { value: "Тампа Бэй Лайтнинг в сезоне 2014/2015" } },
  claims: { P641: [claim({ id: "Q41466" })] },
};
const SPIRIT_NO_SPORT: WikidataEntity = {
  labels: { en: { value: "Team Spirit" } },
  claims: { P154: [claim("Team Spirit logo.png")] },
};

const keys = (...names: string[]) => new Set(names.map(teamKey));

describe("teamKey", () => {
  it("сводит разные написания одного клуба", () => {
    expect(teamKey("FK Zenit Saint Petersburg")).toBe("zenit saint petersburg");
    expect(teamKey("Zenit St. Petersburg")).toBe("zenit saint petersburg");
    expect(teamKey("Atlético Madrid")).toBe("atletico madrid");
    expect(teamKey("Brighton & Hove Albion")).toBe("brighton and hove albion");
  });

  it("поддерживает русские названия", () => {
    expect(teamKey("ФК «Зенит»")).toBe("зенит");
    expect(teamKey("Тампа-Бэй Лайтнинг")).toBe("тампа бэй лайтнинг");
    expect(teamKey("Спартак-Йошкар-Ола")).toBe(teamKey("Спартак Йошкар Ола"));
    expect(teamKey("Шахтёр")).toBe("шахтер");
  });

  it("сохраняет цифры", () => {
    expect(teamKey("Schalke 04")).toBe("schalke 04");
  });
});

describe("strippedQuery", () => {
  it("убирает общие слова", () => {
    expect(strippedQuery("FC Zenit Saint Petersburg")).toBe("Zenit Saint Petersburg");
    expect(strippedQuery("Leeds United")).toBeNull();
  });
});

describe("pickSportsDbBadge", () => {
  it("не берёт логотип другого вида спорта", () => {
    expect(pickSportsDbBadge([ZENIT_VOLLEY], "football", keys("FC Zenit Saint Petersburg"))).toBeNull();
  });

  it("берёт логотип при совпадении спорта и названия", () => {
    expect(pickSportsDbBadge([ZENIT_FOOTBALL], "football", keys("FK Zenit Saint Petersburg"))).toBe(`${ZENIT_FOOTBALL.strBadge}/small`);
    expect(pickSportsDbBadge([ZENIT_VOLLEY], "volleyball", keys("Zenit Saint Petersburg"))).toBe(`${ZENIT_VOLLEY.strBadge}/small`);
  });

  it("сопоставляет по русскому альтернативному названию", () => {
    expect(pickSportsDbBadge([ZENIT_FOOTBALL], "football", keys("Футбольный клуб «Зенит»"))).toBe(`${ZENIT_FOOTBALL.strBadge}/small`);
  });

  it("не берёт похожую, но другую команду", () => {
    expect(pickSportsDbBadge([IZHEVSK], "football", keys("FC Zenit"))).toBeNull();
  });

  it("не ищет для видов спорта без командных логотипов", () => {
    expect(pickSportsDbBadge([ZENIT_FOOTBALL], "tennis", keys("Zenit Saint Petersburg"))).toBeNull();
  });
});

describe("pickWikidataLogo", () => {
  it("находит клуб по русскому названию и виду спорта, отбрасывая сезоны", () => {
    expect(pickWikidataLogo([TAMPA, TAMPA_SEASON], "hockey", keys("Тампа-Бэй Лайтнинг"))).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Tampa_Bay_Lightning_2011.svg?width=160",
    );
  });

  it("не берёт логотип без подтверждённого вида спорта", () => {
    expect(pickWikidataLogo([SPIRIT_NO_SPORT], "dota", keys("Team Spirit"))).toBeNull();
  });

  it("не берёт логотип другого вида спорта", () => {
    expect(pickWikidataLogo([TAMPA], "football", keys("Tampa Bay Lightning"))).toBeNull();
  });

  it("не выбирает при нескольких одинаково подходящих сущностях", () => {
    expect(pickWikidataLogo([TAMPA, { ...TAMPA }], "hockey", keys("Tampa Bay Lightning"))).toBeNull();
  });
});

function sink(candidates: LogoCandidate[]) {
  const saved: LogoResult[] = [];
  const s: LogosSink = {
    teamsNeedingLogos: async () => candidates,
    setTeamLogos: async (items) => {
      saved.push(...items);
      return items.length;
    },
  };
  return { s, saved };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("syncTeamLogos", () => {
  it("НХЛ — из NHL API, футбол — из TheSportsDB, новая команда без английского названия — из Wikidata", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("api-web.nhle.com")) {
        return json({ standings: [{ teamName: { default: "Washington Capitals" }, teamLogo: "https://assets.nhle.com/logos/nhl/svg/WSH_light.svg" }] });
      }
      if (u.includes("thesportsdb") && u.includes("FC%20Zenit")) return json({ teams: [ZENIT_VOLLEY] });
      if (u.includes("thesportsdb") && u.includes("Zenit%20Saint")) return json({ teams: [ZENIT_FOOTBALL] });
      if (u.includes("thesportsdb")) return json({ teams: null });
      if (u.includes("wbsearchentities") && u.includes("language=ru") && u.includes(encodeURIComponent("Тампа"))) {
        return json({ search: [{ id: "Q201864" }, { id: "Q17016179" }] });
      }
      if (u.includes("wbsearchentities")) return json({ search: [] });
      if (u.includes("wbgetentities")) return json({ entities: { Q201864: TAMPA, Q17016179: TAMPA_SEASON } });
      throw new Error(`unexpected ${u}`);
    });
    const { s, saved } = sink([
      { team_id: "wsh", sport_id: "hockey", name: "Вашингтон Кэпиталз", name_en: "Washington Capitals" },
      { team_id: "zen", sport_id: "football", name: "Зенит Санкт-Петербург", name_en: "FC Zenit Saint Petersburg" },
      { team_id: "tbl", sport_id: "hockey", name: "Тампа-Бэй Лайтнинг", name_en: null },
      { team_id: "none", sport_id: "football", name: "Неизвестный клуб", name_en: "Unknown Club" },
    ]);
    const report = await syncTeamLogos(s, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(saved).toEqual([
      { team_id: "wsh", logo_url: "https://assets.nhle.com/logos/nhl/svg/WSH_light.svg", logo_source: "nhl" },
      { team_id: "zen", logo_url: `${ZENIT_FOOTBALL.strBadge}/small`, logo_source: "thesportsdb" },
      {
        team_id: "tbl",
        logo_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Tampa_Bay_Lightning_2011.svg?width=160",
        logo_source: "wikidata",
      },
      { team_id: "none", logo_url: null, logo_source: null },
    ]);
    expect(report).toMatchObject({ checked: 4, found: 3, errors: 0 });
  });

  it("при сбое источника команда не помечается проверенной", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429));
    const { s, saved } = sink([{ team_id: "a", sport_id: "football", name: "Лидс", name_en: "Leeds United" }]);
    const report = await syncTeamLogos(s, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(saved).toEqual([]);
    expect(report).toMatchObject({ checked: 0, errors: 1 });
  });
});
