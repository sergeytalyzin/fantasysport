// Проверка интеграции OddsPapi на реальных данных (только чтение, в БД ничего не пишет).
//
//   ODDSPAPI_API_KEY=ваш_ключ node scripts/oddspapi-probe.mjs
//
// Выводит:
//  1) sportId хоккея, футбола и баскетбола;
//  2) кандидатов в tournamentId для КХЛ, НХЛ, РПЛ, АПЛ, ЛЧ, НБА;
//  3) названия рынков player props с исходами Over/Under — для DEFAULT_MARKET_RULES;
//  4) пример матча: participant1/participant2 и пример линий спортсменов.
// Сырые ответы сохраняются в .oddspapi-probe/ (папка в .gitignore).

import { mkdir, writeFile } from "node:fs/promises";

const KEY = process.env.ODDSPAPI_API_KEY;
if (!KEY) {
  console.error("Задайте ODDSPAPI_API_KEY");
  process.exit(1);
}
const BASE = "https://api.oddspapi.io/v4";
const OUT = ".oddspapi-probe";
// Cooldown эндпоинтов из документации, мс.
const COOLDOWN = { sports: 1000, tournaments: 1000, fixtures: 2000, markets: 1000, odds: 500 };
const last = {};

async function get(endpoint, params = {}) {
  const wait = (last[endpoint] ?? 0) + (COOLDOWN[endpoint] ?? 1000) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait + 50));
  last[endpoint] = Date.now();
  const query = new URLSearchParams({ ...params, apiKey: KEY });
  const res = await fetch(`${BASE}/${endpoint}?${query}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const name = `${endpoint}${Object.values(params).length ? "-" + Object.values(params).join("-") : ""}`.replace(/[^\w-]/g, "_");
  await writeFile(`${OUT}/${name}.json`, JSON.stringify(data, null, 2));
  return data;
}

// Сопоставление по названию турнира и стране (проверено на реальном ответе).
const LEAGUES = [
  { code: "KHL", sport: "hockey", match: (t) => t.tournamentName === "KHL" },
  { code: "NHL", sport: "hockey", match: (t) => t.tournamentName === "NHL" },
  { code: "RPL", sport: "football", match: (t) => t.tournamentName === "Premier League" && t.categoryName === "Russia" },
  { code: "EPL", sport: "football", match: (t) => t.tournamentName === "Premier League" && t.categoryName === "England" },
  { code: "UCL", sport: "football", match: (t) => t.tournamentName === "UEFA Champions League" },
  { code: "NBA", sport: "basketball", match: (t) => t.tournamentName === "NBA" },
];

await mkdir(OUT, { recursive: true });

console.log("\n=== 1. Виды спорта ===");
const sports = await get("sports");
const sportIds = {
  football: sports.find((s) => s.slug === "soccer")?.sportId,
  basketball: sports.find((s) => s.slug === "basketball")?.sportId,
  hockey: sports.find((s) => /hockey/.test(s.slug))?.sportId,
};
console.table(sports.filter((s) => Object.values(sportIds).includes(s.sportId)));

console.log("\n=== 2. Кандидаты в tournamentId ===");
const sql = [];
for (const [sport, sportId] of Object.entries(sportIds)) {
  if (!sportId) {
    console.log(`  ${sport}: вид спорта не найден`);
    continue;
  }
  const tournaments = await get("tournaments", { sportId });
  for (const league of LEAGUES.filter((l) => l.sport === sport)) {
    const found = tournaments.filter(league.match);
    console.log(`  ${league.code}:`);
    for (const t of found) {
      console.log(
        `    ${t.tournamentId}  ${t.tournamentName} (${t.categoryName})  матчей: ${t.upcomingFixtures} скоро, ${t.futureFixtures} позже`,
      );
    }
    if (found.length === 1) {
      sql.push(`update public.leagues set external_ids = external_ids || '{"oddspapi": "${found[0].tournamentId}"}' where code = '${league.code}';`);
    } else if (found.length === 0) {
      console.log("    не найдено — посмотрите .oddspapi-probe/tournaments-*.json вручную");
    }
  }
}

console.log("\n=== 3. Рынки player props с Over/Under ===");
const markets = await get("markets");
const props = markets.filter((m) => {
  const names = (m.outcomes ?? []).map((o) => o.outcomeName.toLowerCase());
  return m.playerProp && names.includes("over") && names.includes("under");
});
const sportById = Object.fromEntries(Object.entries(sportIds).map(([k, v]) => [v, k]));
const byName = new Map();
for (const m of props) {
  if (!sportById[m.sportId]) continue;
  const key = `${sportById[m.sportId]} | ${m.marketName}`;
  const entry = byName.get(key) ?? { lines: [], marketType: m.marketType, period: m.period };
  entry.lines.push(m.handicap);
  byName.set(key, entry);
}
for (const [key, v] of [...byName].sort()) {
  const lines = [...new Set(v.lines)].sort((a, b) => a - b);
  console.log(`  ${key}  [${v.marketType}, ${v.period}]  линии: ${lines.slice(0, 6).join(", ")}${lines.length > 6 ? " …" : ""}`);
}

console.log("\n=== 4. Пример матча и линий ===");
const nbaId = sql.find((s) => s.includes("'NBA'"))?.match(/"oddspapi": "(\d+)"/)?.[1];
const anyTournament = nbaId ?? sql[0]?.match(/"oddspapi": "(\d+)"/)?.[1];
if (anyTournament) {
  const fixtures = await get("fixtures", { tournamentId: anyTournament });
  const fixture = fixtures.find((f) => f.hasOdds && f.statusId === 0) ?? fixtures[0];
  if (fixture) {
    console.log(`  ${fixture.fixtureId}: participant1 = ${fixture.participant1Name}, participant2 = ${fixture.participant2Name}, начало ${fixture.startTime}`);
    console.log("  → сверьте с расписанием лиги, кто хозяин (у нас принято participant1 = хозяева)");
    const odds = await get("odds", { fixtureId: fixture.fixtureId });
    const propIds = new Map(props.map((m) => [String(m.marketId), m]));
    let shown = 0;
    for (const [bookmaker, bo] of Object.entries(odds.bookmakerOdds ?? {})) {
      for (const [marketId, market] of Object.entries(bo.markets ?? {})) {
        const meta = propIds.get(marketId);
        if (!meta) continue;
        for (const outcome of Object.values(market.outcomes ?? {})) {
          for (const [playerId, p] of Object.entries(outcome.players ?? {})) {
            if (playerId === "0" || !p.playerName || shown >= 10) continue;
            console.log(`    ${bookmaker}: ${p.playerName} (id ${playerId}) — ${meta.marketName} ${meta.handicap}${p.mainLine ? " [mainLine]" : ""}`);
            shown++;
          }
        }
      }
    }
    if (shown === 0) console.log("    player props для этого матча нет (проверьте тариф и букмекеров)");
  }
}

console.log("\n=== SQL для привязки лиг (проверьте перед выполнением) ===");
console.log(sql.join("\n") || "  нет однозначных совпадений");
console.log(`\nСырые ответы: ${OUT}/`);
