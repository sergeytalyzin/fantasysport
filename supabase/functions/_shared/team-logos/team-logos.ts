// Логотипы команд из открытых источников. OddsPapi (основной API) логотипов не отдаёт:
// в /v4/fixtures и /v4/participants только id и названия.
// Источники по порядку, проверено на реальных ответах:
//   NHL API     GET https://api-web.nhle.com/v1/standings/now — официальные эмблемы 32 клубов (teamName, teamLogo)
//   OpenDota    GET https://api.opendota.com/api/teams        — ~1000 команд Dota 2 (name, logo_url)
//   TheSportsDB GET /api/v1/json/{key}/searchteams.php?t=…   — одна лучшая команда (strTeam, strTeamAlternate, strSport, strBadge)
//   Wikidata    wbsearchentities + wbgetentities             — P154 (логотип на Wikimedia Commons), P641 (вид спорта);
//                                                             поиск и по-английски, и по-русски
// Логотип сохраняется, только если совпали вид спорта и название (английское или русское,
// включая альтернативные написания источника) и кандидат единственный. При сомнении
// команда остаётся без логотипа — на сайте показывается аббревиатура.

import { ProviderHttpError, type SportId } from "../sports-providers/types.ts";

export interface LogoCandidate {
  team_id: string;
  sport_id: SportId;
  /** Название на сайте (обычно русское). */
  name: string;
  /** Английское название из OddsPapi; у новых команд может отсутствовать. */
  name_en: string | null;
}

export type LogoSource = "nhl" | "opendota" | "thesportsdb" | "wikidata";

export interface LogoResult {
  team_id: string;
  /** null — проверено, логотип не найден (найденный ранее логотип сохраняется). */
  logo_url: string | null;
  logo_source: LogoSource | null;
}

export interface LogosSink {
  teamsNeedingLogos(limit: number): Promise<LogoCandidate[]>;
  setTeamLogos(items: LogoResult[]): Promise<number>;
}

type Fetch = typeof fetch;

// Общие слова в названиях клубов, которые источники пишут по-разному.
const STOP_WORDS = new Set([
  "fc", "fk", "cf", "afc", "sc", "hc", "hk", "bc", "bk", "club", "team", "the",
  "фк", "пфк", "хк", "бк", "вк", "гк", "клуб",
]);

/** «FK Zenit Saint Petersburg» и «Zenit St. Petersburg» → «zenit saint petersburg». */
export function teamKey(name: string): string {
  return name
    // Диакритика снимается только у латиницы: «Atlético» → «atletico», но «й» остаётся «й».
    .normalize("NFD")
    .replace(/([a-z])\p{M}+/giu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t))
    .map((t) => (t === "st" ? "saint" : t))
    .join(" ");
}

/** Ключи названий нашей команды: английское и русское. */
function keysOf(c: LogoCandidate): Set<string> {
  return new Set([c.name_en, c.name].filter((n): n is string => Boolean(n)).map(teamKey).filter(Boolean));
}

/** Запрос без общих слов: «FC Zenit Saint Petersburg» → «Zenit Saint Petersburg». */
export function strippedQuery(name: string): string | null {
  const tokens = name.split(/\s+/).filter((t) => !STOP_WORDS.has(t.toLowerCase().replace(/\./g, "")));
  const query = tokens.join(" ");
  return query && query !== name ? query : null;
}

const SPORTSDB_SPORT: Partial<Record<SportId, string>> = {
  football: "Soccer",
  basketball: "Basketball",
  hockey: "Ice Hockey",
  volleyball: "Volleyball",
  handball: "Handball",
  baseball: "Baseball",
  american_football: "American Football",
  rugby: "Rugby",
  dota: "ESports",
  cs: "ESports",
  lol: "ESports",
  valorant: "ESports",
};

// Wikidata P641 (вид спорта). Киберспортивные команды помечены киберспортом или игрой.
const ESPORTS = ["Q300920"];
const WIKIDATA_SPORT: Partial<Record<SportId, string[]>> = {
  football: ["Q2736"],
  basketball: ["Q5372"],
  hockey: ["Q41466"],
  volleyball: ["Q1734"],
  handball: ["Q8418"],
  baseball: ["Q5369"],
  american_football: ["Q41323"],
  rugby: ["Q5849", "Q10962"],
  futsal: ["Q172416"],
  dota: [...ESPORTS, "Q771541"],
  cs: [...ESPORTS, "Q842146"],
  lol: [...ESPORTS, "Q223341"],
  valorant: [...ESPORTS],
};

export interface SportsDbTeam {
  strTeam: string;
  strTeamAlternate?: string | null;
  strTeamShort?: string | null;
  strSport: string;
  strBadge?: string | null;
}

/** Логотип из ответа TheSportsDB, если это та же команда того же вида спорта. */
export function pickSportsDbBadge(teams: SportsDbTeam[] | null, sport: SportId, keys: Set<string>): string | null {
  const wantedSport = SPORTSDB_SPORT[sport];
  if (!wantedSport || keys.size === 0) return null;
  const found = (teams ?? []).filter((t) => {
    if (t.strSport !== wantedSport || !t.strBadge) return false;
    const names = [t.strTeam, ...(t.strTeamAlternate ?? "").split(","), t.strTeamShort ?? ""];
    return names.some((n) => n.trim() && keys.has(teamKey(n)));
  });
  // Уменьшенная копия (250 px) — сервис отдаёт её по суффиксу /small.
  return found.length === 1 ? `${found[0].strBadge}/small` : null;
}

export interface WikidataEntity {
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>;
}

const claimValues = (e: WikidataEntity, prop: string) =>
  (e.claims?.[prop] ?? []).map((c) => c.mainsnak.datavalue?.value).filter((v) => v !== undefined);

/** Логотип с Wikimedia Commons, если ровно одна сущность — команда нужного вида спорта с тем же названием. */
export function pickWikidataLogo(entities: WikidataEntity[], sport: SportId, keys: Set<string>): string | null {
  const sports = WIKIDATA_SPORT[sport];
  if (!sports || keys.size === 0) return null;
  const found = entities.filter((e) => {
    const logo = claimValues(e, "P154")[0];
    if (typeof logo !== "string") return false;
    const entitySports = claimValues(e, "P641").map((v) => (v as { id?: string }).id);
    if (!entitySports.some((s) => s && sports.includes(s))) return false;
    const names = [
      ...Object.values(e.labels ?? {}).map((l) => l.value),
      ...Object.values(e.aliases ?? {}).flatMap((list) => list.map((a) => a.value)),
    ];
    return names.some((n) => keys.has(teamKey(n)));
  });
  if (found.length !== 1) return null;
  const file = claimValues(found[0], "P154")[0] as string;
  // Commons отдаёт уменьшенную PNG-копию (и для SVG) по параметру width.
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=160`;
}

/** Уникальное совпадение по названию в словаре «ключ → логотип» (неоднозначные ключи исключены). */
function uniqueIndex(entries: { name: string; logo: string | null }[]): Map<string, string> {
  const index = new Map<string, string | null>();
  for (const { name, logo } of entries) {
    if (!logo) continue;
    const key = teamKey(name);
    if (!key) continue;
    index.set(key, index.has(key) && index.get(key) !== logo ? null : logo);
  }
  return new Map([...index].filter((e): e is [string, string] => e[1] !== null));
}

// Wikimedia просит указывать в User-Agent назначение запросов.
const HEADERS = { Accept: "application/json", "User-Agent": "PICKUP-team-logos/1.0 (team logo lookup)" };

async function getJson<T>(fetchImpl: Fetch, url: string): Promise<T> {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) {
    const { hostname, pathname } = new URL(url);
    throw new ProviderHttpError(hostname, res.status, pathname.replace(/\/json\/[^/]+\//, "/json/***/"), await res.text());
  }
  return (await res.json()) as T;
}

async function nhlLogos(fetchImpl: Fetch): Promise<Map<string, string>> {
  const data = await getJson<{ standings: { teamName: { default: string }; teamLogo: string }[] }>(
    fetchImpl,
    "https://api-web.nhle.com/v1/standings/now",
  );
  return uniqueIndex(data.standings.map((s) => ({ name: s.teamName.default, logo: s.teamLogo })));
}

async function openDotaLogos(fetchImpl: Fetch): Promise<Map<string, string>> {
  const teams = await getJson<{ name: string | null; logo_url: string | null }[]>(fetchImpl, "https://api.opendota.com/api/teams");
  return uniqueIndex(teams.map((t) => ({ name: t.name ?? "", logo: t.logo_url })));
}

const BULK: Partial<Record<SportId, { source: LogoSource; load: (f: Fetch) => Promise<Map<string, string>> }>> = {
  hockey: { source: "nhl", load: nhlLogos },
  dota: { source: "opendota", load: openDotaLogos },
};

export async function syncTeamLogos(
  sink: LogosSink,
  { limit = 12, sportsDbKey = "123", fetchImpl = fetch }: { limit?: number; sportsDbKey?: string; fetchImpl?: Fetch } = {},
) {
  const candidates = await sink.teamsNeedingLogos(limit);
  if (candidates.length === 0) return { checked: 0, found: 0, errors: 0 };

  // Словари NHL и OpenDota — один запрос за запуск и только если они нужны.
  const bulk = new Map<SportId, Promise<Map<string, string>>>();
  const bulkFor = (sport: SportId) => {
    const b = BULK[sport];
    if (!b) return null;
    if (!bulk.has(sport)) bulk.set(sport, b.load(fetchImpl));
    return bulk.get(sport)!;
  };

  const searchSportsDb = async (query: string) =>
    (
      await getJson<{ teams: SportsDbTeam[] | null }>(
        fetchImpl,
        `https://www.thesportsdb.com/api/v1/json/${sportsDbKey}/searchteams.php?t=${encodeURIComponent(query)}`,
      )
    ).teams;

  const searchWikidata = async (query: string, language: "en" | "ru") => {
    const api = "https://www.wikidata.org/w/api.php?format=json&";
    const search = await getJson<{ search: { id: string }[] }>(
      fetchImpl,
      `${api}action=wbsearchentities&type=item&limit=7&language=${language}&search=${encodeURIComponent(query)}`,
    );
    if (search.search.length === 0) return [];
    const ids = search.search.map((s) => s.id).join("|");
    const data = await getJson<{ entities: Record<string, WikidataEntity> }>(
      fetchImpl,
      `${api}action=wbgetentities&props=claims|labels|aliases&languages=en|ru&ids=${ids}`,
    );
    return Object.values(data.entities);
  };

  const find = async (c: LogoCandidate): Promise<Pick<LogoResult, "logo_url" | "logo_source">> => {
    const keys = keysOf(c);
    const b = bulkFor(c.sport_id);
    if (b) {
      const index = await b;
      const logo = [...keys].map((k) => index.get(k)).find(Boolean);
      if (logo) return { logo_url: logo, logo_source: BULK[c.sport_id]!.source };
    }
    if (c.name_en && SPORTSDB_SPORT[c.sport_id]) {
      const queries = [c.name_en, strippedQuery(c.name_en)].filter((q): q is string => Boolean(q));
      for (const q of queries) {
        const logo = pickSportsDbBadge(await searchSportsDb(q), c.sport_id, keys);
        if (logo) return { logo_url: logo, logo_source: "thesportsdb" };
      }
    }
    if (WIKIDATA_SPORT[c.sport_id]) {
      const queries: [string, "en" | "ru"][] = c.name_en ? [[c.name_en, "en"], [c.name, "ru"]] : [[c.name, "ru"]];
      for (const [q, lang] of queries) {
        const logo = pickWikidataLogo(await searchWikidata(q, lang), c.sport_id, keys);
        if (logo) return { logo_url: logo, logo_source: "wikidata" };
      }
    }
    return { logo_url: null, logo_source: null };
  };

  const results: LogoResult[] = [];
  const errors: string[] = [];
  // Последовательно: бесплатный ключ TheSportsDB — до 30 запросов в минуту.
  for (const c of candidates) {
    try {
      results.push({ team_id: c.team_id, ...(await find(c)) });
    } catch (e) {
      // Сбой источника — команда не помечается проверенной и попадёт в следующий запуск.
      errors.push(e instanceof Error ? e.message : String(e));
      if (e instanceof ProviderHttpError && e.status === 429) break;
    }
  }
  await sink.setTeamLogos(results);
  return {
    checked: results.length,
    found: results.filter((r) => r.logo_url).length,
    errors: errors.length,
    ...(errors.length ? { first_error: errors[0].slice(0, 300) } : {}),
  };
}
