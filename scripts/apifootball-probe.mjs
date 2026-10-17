// Проверка API-Football на реальных данных (только чтение, ~6 запросов из 100 бесплатных в сутки).
//
//   APIFOOTBALL_API_KEY=ваш_ключ node scripts/apifootball-probe.mjs
//
// Выводит ID лиг (РПЛ, АПЛ, ЛЧ), текущий сезон и реальную структуру
// статистики игроков завершённого матча — сверка с разбором в
// supabase/functions/_shared/sports-providers/results/apifootball-results-provider.ts.

import { mkdir, writeFile } from "node:fs/promises";

const KEY = process.env.APIFOOTBALL_API_KEY;
if (!KEY) {
  console.error("Задайте APIFOOTBALL_API_KEY");
  process.exit(1);
}
const BASE = "https://v3.football.api-sports.io";
const OUT = ".apifootball-probe";
await mkdir(OUT, { recursive: true });

async function get(endpoint, params) {
  await new Promise((r) => setTimeout(r, 6500)); // бесплатный тариф ограничивает частоту
  const res = await fetch(`${BASE}/${endpoint}?${new URLSearchParams(params)}`, { headers: { "x-apisports-key": KEY } });
  const body = await res.json();
  await writeFile(`${OUT}/${endpoint.replace("/", "_")}-${Object.values(params).join("_")}.json`, JSON.stringify(body, null, 2));
  const errors = body.errors && (Array.isArray(body.errors) ? body.errors.length : Object.keys(body.errors).length);
  if (!res.ok || errors) throw new Error(`${endpoint}: HTTP ${res.status} ${JSON.stringify(body.errors)}`);
  console.log(`  [${endpoint}] осталось запросов сегодня: ${res.headers.get("x-ratelimit-requests-remaining") ?? "?"}`);
  return body.response ?? [];
}

const TARGETS = [
  { code: "RPL", params: { country: "Russia", type: "league" }, pick: (l) => /premier/i.test(l.league.name) },
  { code: "EPL", params: { country: "England", type: "league" }, pick: (l) => l.league.name === "Premier League" },
  // search нельзя сочетать с type и current.
  { code: "UCL", params: { search: "Champions League" }, pick: (l) => l.league.name === "UEFA Champions League" },
];

console.log("\n=== 1. Лиги и текущие сезоны ===");
const sql = [];
const found = [];
for (const t of TARGETS) {
  const leagues = await get("leagues", t.params.search ? t.params : { ...t.params, current: "true" });
  const league = leagues.find(t.pick);
  if (!league) {
    console.log(`  ${t.code}: не найдена — см. ${OUT}/`);
    continue;
  }
  const season = league.seasons?.find((s) => s.current)?.year;
  const coverage = league.seasons?.find((s) => s.current)?.coverage?.fixtures;
  console.log(`  ${t.code}: id=${league.league.id} «${league.league.name}» сезон=${season} статистика игроков=${coverage?.statistics_players}`);
  found.push({ code: t.code, id: league.league.id, season });
  sql.push(`update public.leagues set external_ids = external_ids || '{"apifootball": "${league.league.id}"}' where code = '${t.code}';`);
}

console.log("\n=== 2. Статистика игроков завершённого матча ===");
// Бесплатный тариф не даёт параметр season текущего сезона, но отдаёт матчи
// за дату в окне «вчера–завтра» — так же ищет и провайдер.
const ids = new Set(found.map((f) => f.id));
let done = null;
for (const offset of [0, -1]) {
  const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const fixtures = await get("fixtures", { date });
  done = fixtures.find((f) => ids.has(f.league.id) && ["FT", "AET", "PEN"].includes(f.fixture.status.short));
  if (done) break;
}
if (!done) {
  console.log("  нет завершённых матчей наших лиг за сегодня и вчера — повторите позже");
} else {
  console.log(`  ${done.teams.home.name} ${done.goals.home}:${done.goals.away} ${done.teams.away.name}, id ${done.fixture.id}`);
  const teams = await get("fixtures/players", { fixture: String(done.fixture.id) });
  const sample = teams[0]?.players?.slice(0, 4) ?? [];
  for (const p of sample) {
    const st = Array.isArray(p.statistics) ? p.statistics[0] : p.statistics;
    console.log(
      `    ${p.player.name}: minutes=${st?.games?.minutes} shots.total=${st?.shots?.total} shots.on=${st?.shots?.on} goals.total=${st?.goals?.total} passes.total=${st?.passes?.total}`,
    );
  }
  console.log(`  statistics — ${Array.isArray(sample[0]?.statistics) ? "массив (как ожидает провайдер)" : "объект"}`);
}

console.log("\n=== SQL для привязки лиг ===");
console.log(sql.join("\n") || "  нет совпадений");
console.log(`\nСырые ответы: ${OUT}/`);
