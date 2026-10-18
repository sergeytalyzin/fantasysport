// Фотографии спортсменов из официальных и свободно лицензированных источников.
// OddsPapi (источник линий) фото и ID лиг не отдаёт — только имя спортсмена.
// Проверено на реальных ответах (октябрь 2026):
//   НХЛ  api-web.nhle.com/v1/standings/now, /v1/roster/{TEAM}/current, /v1/player/{id}/landing —
//        поле headshot (assets.nhle.com/mugs/nhl/{season}/{TEAM}/{id}.png). Адрес «latest/520x520/{id}»
//        для части игроков перенаправляет на default-skater.png, поэтому берётся headshot из API.
//   НБА  cdn.nba.com/headshots/nba/latest/1040x760/{personId}.png. Для неизвестного ID CDN отдаёт
//        силуэт с кодом 200 — ID берётся только подтверждённый (Wikidata P3647 «NBA.com player ID»),
//        а силуэт отсекается сравнением хэша. Справочники stats.nba.com / cdn.nba.com/static закрыты (403).
//   Футбол Sportmonks /v3/football/players/search/{name} (image_path) — только при SPORTMONKS_API_KEY.
//   Остальное Wikidata (P31 человек, P641 вид спорта, P18 фото, P54 команды, P3522 NHL ID) +
//        Wikimedia Commons (лицензия, автор). Берутся только CC0 / PD / CC BY / CC BY-SA.
//   КХЛ, киберспорт — открытых официальных API с фото нет; используются Wikidata/Commons.
// Фото сохраняется, только если личность подтверждена однозначно (имя + вид спорта, при
// неоднозначности — команда) и картинка реально доступна. Иначе на сайте — силуэт.

import { normalizeName } from "../sports-providers/results/matching.ts";
import { ProviderHttpError, type SportId } from "../sports-providers/types.ts";

export interface PhotoCandidate {
  player_id: string;
  sport_id: SportId;
  full_name: string;
  /** Лиги матчей с линиями на спортсмена. */
  league_codes: string[];
  /** Команды этих матчей (английские названия, если известны) — спортсмен играет за одну из них. */
  team_names: string[];
  /** Те же команды с id — чтобы привязать спортсмена к его команде. */
  teams?: { id: string; name: string }[] | null;
  photo_url: string | null;
}

export type PhotoSource = "nhl" | "nba" | "sportmonks" | "wikimedia";

export interface PhotoInfo {
  photo_url: string;
  photo_source: PhotoSource;
  external_player_id: string | null;
  photo_license: string;
  photo_author: string | null;
  photo_license_url: string | null;
  /** Страница файла с полной информацией об авторстве. */
  photo_page_url: string | null;
  /** Профиль из официального ростера лиги (НХЛ): команда, амплуа (C/L/R/D/G), номер. */
  team_id?: string | null;
  position?: string | null;
  jersey_number?: number | null;
}

/**
 * found: false, keep: true — источник не подтвердил фото, но прежнее доступно (оставить);
 * found: false, keep: false — фото нет или прежнее недоступно (очистить).
 */
export type PhotoResult = { player_id: string } & (({ found: true } & PhotoInfo) | { found: false; keep: boolean });

export interface PhotosSink {
  playersNeedingPhotos(limit: number): Promise<PhotoCandidate[]>;
  setPlayerPhotos(items: PhotoResult[]): Promise<number>;
}

type Fetch = typeof fetch;

// Wikimedia требует User-Agent с контактом владельца и ограничивает частоту запросов
// (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits). Контакт — WIKIMEDIA_CONTACT.
const HEADERS = { Accept: "application/json", "User-Agent": "PICKUP-player-photos/1.0 (athlete photo lookup)" };
const WIKIMEDIA = /(^|\.)(wikidata|wikimedia)\.org$/;
let wikimediaDelayMs = 1000;
let lastWikimediaAt = 0;

async function getJson<T>(fetchImpl: Fetch, url: string): Promise<T> {
  if (WIKIMEDIA.test(new URL(url).hostname) && wikimediaDelayMs > 0) {
    const wait = lastWikimediaAt + wikimediaDelayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastWikimediaAt = Date.now();
  }
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) {
    const { hostname, pathname } = new URL(url);
    throw new ProviderHttpError(hostname, res.status, pathname, await res.text());
  }
  return (await res.json()) as T;
}

const sameName = (a: string, b: string) => normalizeName(a) === normalizeName(b);

// ---------- Проверка изображения ----------

async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Картинка доступна, это изображение и не заглушка источника. */
export async function imageAvailable(fetchImpl: Fetch, url: string, placeholderHash?: string | null): Promise<boolean> {
  const res = await fetchImpl(url, { headers: { "User-Agent": HEADERS["User-Agent"] }, redirect: "follow" });
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
    await res.body?.cancel();
    return false;
  }
  // NHL перенаправляет отсутствующие фото на default-skater.png / default-goalie.png.
  if (/\/default-[a-z]+\.png$/i.test(res.url)) {
    await res.body?.cancel();
    return false;
  }
  if (placeholderHash) return (await sha256(await res.arrayBuffer())) !== placeholderHash;
  await res.body?.cancel();
  return true;
}

// ---------- НХЛ ----------

interface NhlRosterPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  headshot?: string;
  positionCode?: string;
  sweaterNumber?: number;
}

const NHL_RIGHTS = "© NHL — официальное фото лиги";

class NhlSource {
  private abbrevByTeam: Promise<Map<string, string>> | null = null;
  private rosters = new Map<string, Promise<NhlRosterPlayer[]>>();
  constructor(private readonly fetchImpl: Fetch) {}

  private teams() {
    this.abbrevByTeam ??= getJson<{ standings: { teamName: { default: string }; teamAbbrev: { default: string } }[] }>(
      this.fetchImpl,
      "https://api-web.nhle.com/v1/standings/now",
    ).then((d) => new Map(d.standings.map((s) => [normalizeName(s.teamName.default), s.teamAbbrev.default])));
    return this.abbrevByTeam;
  }

  private roster(abbrev: string) {
    if (!this.rosters.has(abbrev)) {
      this.rosters.set(
        abbrev,
        getJson<Record<string, NhlRosterPlayer[]>>(this.fetchImpl, `https://api-web.nhle.com/v1/roster/${abbrev}/current`).then(
          (r) => [...(r.forwards ?? []), ...(r.defensemen ?? []), ...(r.goalies ?? [])],
        ),
      );
    }
    return this.rosters.get(abbrev)!;
  }

  /** Наша команда матча, соответствующая аббревиатуре NHL. */
  private async teamId(c: PhotoCandidate, abbrev: string | undefined): Promise<string | null> {
    if (!abbrev) return null;
    const teams = await this.teams();
    return c.teams?.find((t) => teams.get(normalizeName(t.name)) === abbrev)?.id ?? null;
  }

  /** Поиск в ростерах команд матча: имя должно совпасть ровно у одного игрока. */
  async fromRosters(c: PhotoCandidate): Promise<PhotoInfo | null> {
    const teams = await this.teams();
    const abbrevs = [...new Set(c.team_names.map((n) => teams.get(normalizeName(n))).filter((a): a is string => Boolean(a)))];
    if (abbrevs.length === 0) return null;
    const players = (
      await Promise.all(abbrevs.map(async (a) => (await this.roster(a)).map((p) => ({ ...p, abbrev: a }))))
    ).flat();
    const found = players.filter((p) => sameName(`${p.firstName.default} ${p.lastName.default}`, c.full_name));
    if (found.length !== 1 || !found[0].headshot) return null;
    const p = found[0];
    return this.info(p.id, p.headshot!, await this.teamId(c, p.abbrev), p.positionCode, p.sweaterNumber);
  }

  /** По NHL ID (например, из Wikidata P3522). */
  async fromId(c: PhotoCandidate, id: string): Promise<PhotoInfo | null> {
    const landing = await getJson<{ headshot?: string; position?: string; sweaterNumber?: number; currentTeamAbbrev?: string }>(
      this.fetchImpl,
      `https://api-web.nhle.com/v1/player/${id}/landing`,
    );
    if (!landing.headshot) return null;
    return this.info(Number(id), landing.headshot, await this.teamId(c, landing.currentTeamAbbrev), landing.position, landing.sweaterNumber);
  }

  private info(id: number, headshot: string, teamId: string | null, position?: string, number?: number): PhotoInfo {
    return {
      photo_url: headshot,
      photo_source: "nhl",
      external_player_id: String(id),
      photo_license: NHL_RIGHTS,
      photo_author: null,
      photo_license_url: null,
      photo_page_url: `https://www.nhl.com/player/${id}`,
      team_id: teamId,
      position: position ?? null,
      jersey_number: number ?? null,
    };
  }
}

// ---------- НБА ----------

const nbaHeadshot = (id: string) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`;

// ---------- Sportmonks (футбол) ----------

interface SportmonksPlayer {
  id: number;
  name?: string | null;
  display_name?: string | null;
  common_name?: string | null;
  image_path?: string | null;
  teams?: { team?: { name?: string | null } | null }[];
}

async function sportmonksPhoto(fetchImpl: Fetch, apiKey: string, c: PhotoCandidate): Promise<PhotoInfo | null> {
  const url = `https://api.sportmonks.com/v3/football/players/search/${encodeURIComponent(c.full_name)}?include=teams.team&api_token=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new ProviderHttpError("sportmonks", res.status, "/v3/football/players/search", await res.text());
  const { data } = (await res.json()) as { data?: SportmonksPlayer[] };
  const teamKeys = new Set(c.team_names.map(normalizeName));
  const found = (data ?? []).filter((p) => {
    const names = [p.name, p.display_name, p.common_name].filter((n): n is string => Boolean(n));
    if (!names.some((n) => sameName(n, c.full_name))) return false;
    if (!p.image_path || /placeholder/i.test(p.image_path)) return false;
    // При известных командах матча спортсмен должен числиться в одной из них.
    if (teamKeys.size === 0) return true;
    return (p.teams ?? []).some((t) => t.team?.name && teamKeys.has(normalizeName(t.team.name)));
  });
  if (found.length !== 1) return null;
  return {
    photo_url: found[0].image_path!,
    photo_source: "sportmonks",
    external_player_id: String(found[0].id),
    photo_license: "© Sportmonks — по подписке Football API",
    photo_author: null,
    photo_license_url: null,
    photo_page_url: null,
  };
}

// ---------- Wikidata / Wikimedia Commons ----------

export interface WikidataEntity {
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>;
}

const claimValues = (e: WikidataEntity, prop: string) =>
  (e.claims?.[prop] ?? []).map((c) => c.mainsnak.datavalue?.value).filter((v) => v !== undefined);
const claimIds = (e: WikidataEntity, prop: string) =>
  claimValues(e, prop).map((v) => (v as { id?: string }).id).filter((v): v is string => Boolean(v));
const entityNames = (e: WikidataEntity) => [
  ...Object.values(e.labels ?? {}).map((l) => l.value),
  ...Object.values(e.aliases ?? {}).flatMap((list) => list.map((a) => a.value)),
];

const ESPORTS = ["Q300920"];
const WIKIDATA_SPORT: Partial<Record<SportId, string[]>> = {
  football: ["Q2736"],
  basketball: ["Q5372"],
  hockey: ["Q41466"],
  tennis: ["Q847"],
  volleyball: ["Q1734"],
  handball: ["Q8418"],
  baseball: ["Q5369"],
  american_football: ["Q41323"],
  mma: ["Q114466"],
  boxing: ["Q32112"],
  table_tennis: ["Q3930"],
  rugby: ["Q5849", "Q10962"],
  cricket: ["Q5375"],
  futsal: ["Q172416"],
  darts: ["Q184207"],
  snooker: ["Q182570"],
  dota: [...ESPORTS, "Q771541"],
  cs: [...ESPORTS, "Q842146"],
  lol: [...ESPORTS, "Q223341"],
  valorant: [...ESPORTS],
};

/** Люди нужного вида спорта с совпадающим именем (подпись или псевдоним, en/ru). */
export function matchingAthletes(entities: WikidataEntity[], sport: SportId, fullName: string): WikidataEntity[] {
  const sports = WIKIDATA_SPORT[sport] ?? [];
  return entities.filter(
    (e) =>
      claimIds(e, "P31").includes("Q5") &&
      claimIds(e, "P641").some((s) => sports.includes(s)) &&
      entityNames(e).some((n) => sameName(n, fullName)),
  );
}

// Свободные лицензии Commons, допускающие использование на сайте с указанием автора.
export function allowedLicense(code: string | undefined): boolean {
  if (!code) return false;
  return /^(cc0|pd(-|$)|cc-by-(sa-)?\d)/i.test(code);
}

const stripHtml = (html: string) =>
  html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, " ").trim();

interface CommonsImageInfo {
  thumburl?: string;
  url: string;
  descriptionurl: string;
  extmetadata?: Record<string, { value: string }>;
}

async function commonsPhoto(fetchImpl: Fetch, file: string): Promise<PhotoInfo | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "400",
    iiextmetadatafilter: "License|LicenseShortName|LicenseUrl|Artist",
    titles: `File:${file}`,
  });
  const data = await getJson<{ query: { pages: Record<string, { imageinfo?: CommonsImageInfo[] }> } }>(
    fetchImpl,
    `https://commons.wikimedia.org/w/api.php?${params}`,
  );
  const info = Object.values(data.query.pages)[0]?.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  if (!info || !allowedLicense(meta.License?.value)) return null;
  return {
    photo_url: info.thumburl ?? info.url,
    photo_source: "wikimedia",
    external_player_id: null,
    photo_license: meta.LicenseShortName?.value ?? meta.License.value,
    photo_author: meta.Artist ? stripHtml(meta.Artist.value).slice(0, 200) || null : null,
    photo_license_url: meta.LicenseUrl?.value ?? null,
    photo_page_url: info.descriptionurl,
  };
}

class Wikidata {
  constructor(private readonly fetchImpl: Fetch) {}

  private api(params: Record<string, string>) {
    return getJson<Record<string, unknown>>(this.fetchImpl, `https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: "json", ...params })}`);
  }

  private async entities(ids: string[], props = "claims|labels|aliases"): Promise<Record<string, WikidataEntity>> {
    if (ids.length === 0) return {};
    const data = (await this.api({ action: "wbgetentities", props, languages: "en|ru", ids: ids.join("|") })) as {
      entities: Record<string, WikidataEntity>;
    };
    return data.entities;
  }

  /** Единственный спортсмен с этим именем и видом спорта; при неоднозначности — по команде (P54). */
  async athlete(c: PhotoCandidate): Promise<WikidataEntity | null> {
    const search = (await this.api({ action: "wbsearchentities", type: "item", limit: "10", language: "en", search: c.full_name })) as {
      search: { id: string }[];
    };
    const found = matchingAthletes(Object.values(await this.entities(search.search.map((s) => s.id))), c.sport_id, c.full_name);
    if (found.length <= 1) return found[0] ?? null;
    if (c.team_names.length === 0) return null;
    const teamKeys = new Set(c.team_names.map(normalizeName));
    const teamIds = [...new Set(found.flatMap((e) => claimIds(e, "P54")))].slice(0, 50);
    const teams = await this.entities(teamIds, "labels|aliases");
    const byTeam = found.filter((e) =>
      claimIds(e, "P54").some((id) => teams[id] && entityNames(teams[id]).some((n) => teamKeys.has(normalizeName(n)))),
    );
    return byTeam.length === 1 ? byTeam[0] : null;
  }
}

const firstString = (e: WikidataEntity, prop: string) => {
  const v = claimValues(e, prop)[0];
  return typeof v === "string" ? v : null;
};

// ---------- Синхронизация ----------

export async function syncPlayerPhotos(
  sink: PhotosSink,
  {
    limit = 10,
    sportmonksKey = null,
    contact = null,
    wikimediaDelay = 1000,
    fetchImpl = fetch,
  }: { limit?: number; sportmonksKey?: string | null; contact?: string | null; wikimediaDelay?: number; fetchImpl?: Fetch } = {},
) {
  HEADERS["User-Agent"] = `PICKUP-player-photos/1.0 (${contact ? contact : "athlete photo lookup"})`;
  wikimediaDelayMs = wikimediaDelay;
  const candidates = await sink.playersNeedingPhotos(limit);
  if (candidates.length === 0) return { checked: 0, found: 0, errors: 0 };

  const nhl = new NhlSource(fetchImpl);
  const wikidata = new Wikidata(fetchImpl);
  let nbaPlaceholder: Promise<string | null> | null = null;
  // Силуэт NBA CDN — тот же файл для любого неизвестного ID.
  const nbaPlaceholderHash = () =>
    (nbaPlaceholder ??= fetchImpl(nbaHeadshot("0"))
      .then(async (r) => (r.ok ? sha256(await r.arrayBuffer()) : null))
      .catch(() => null));

  const verified = async (info: PhotoInfo | null): Promise<PhotoInfo | null> => {
    if (!info) return null;
    const placeholder = info.photo_source === "nba" ? await nbaPlaceholderHash() : null;
    if (info.photo_source === "nba" && !placeholder) return null;
    return (await imageAvailable(fetchImpl, info.photo_url, placeholder)) ? info : null;
  };

  const find = async (c: PhotoCandidate): Promise<PhotoInfo | null> => {
    // 1. Официальные источники лиги.
    if (c.sport_id === "hockey" && c.league_codes.includes("NHL")) {
      const fromRoster = await verified(await nhl.fromRosters(c));
      if (fromRoster) return fromRoster;
    }
    if (c.sport_id === "football" && sportmonksKey) {
      const fromSportmonks = await verified(await sportmonksPhoto(fetchImpl, sportmonksKey, c));
      if (fromSportmonks) return fromSportmonks;
    }
    if (!WIKIDATA_SPORT[c.sport_id]) return null;
    const athlete = await wikidata.athlete(c);
    if (!athlete) return null;
    // 2. Официальный ID лиги из Wikidata.
    const nhlId = firstString(athlete, "P3522");
    if (c.sport_id === "hockey" && nhlId) {
      const fromNhl = await verified(await nhl.fromId(c, nhlId));
      if (fromNhl) return fromNhl;
    }
    const nbaId = firstString(athlete, "P3647");
    if (c.sport_id === "basketball" && nbaId && /^\d+$/.test(nbaId)) {
      const fromNba = await verified({
        photo_url: nbaHeadshot(nbaId),
        photo_source: "nba",
        external_player_id: nbaId,
        photo_license: "© NBA — официальное фото лиги",
        photo_author: null,
        photo_license_url: null,
        photo_page_url: `https://www.nba.com/player/${nbaId}`,
      });
      if (fromNba) return fromNba;
    }
    // 3. Свободно лицензированное фото с Wikimedia Commons.
    const file = firstString(athlete, "P18");
    return file ? verified(await commonsPhoto(fetchImpl, file)) : null;
  };

  const results: PhotoResult[] = [];
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const info = await find(c);
      if (info) {
        results.push({ player_id: c.player_id, found: true, ...info });
      } else {
        const keep = Boolean(c.photo_url) && (await imageAvailable(fetchImpl, c.photo_url!));
        results.push({ player_id: c.player_id, found: false, keep });
      }
    } catch (e) {
      // Сбой источника — спортсмен не помечается проверенным и попадёт в следующий запуск.
      errors.push(e instanceof Error ? e.message : String(e));
      if (e instanceof ProviderHttpError && e.status === 429) break;
    }
  }
  await sink.setPlayerPhotos(results);
  return {
    checked: results.length,
    found: results.filter((r) => r.found).length,
    errors: errors.length,
    ...(errors.length ? { first_error: errors[0].slice(0, 300) } : {}),
  };
}
