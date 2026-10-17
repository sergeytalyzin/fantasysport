import { describe, expect, it } from "vitest";
import { DemoProvider } from "../../supabase/functions/_shared/sports-providers/demo/demo-provider.ts";
import { simulateMatch, type SyncSink, syncLines, syncResults } from "../../supabase/functions/_shared/sports-providers/sync.ts";
import { asUser, createUser, rub, setupTestDatabase, wallet } from "./helpers";

const db = setupTestDatabase();

// Тот же контракт, что реализует Edge Function, но через прямое подключение.
const sink: SyncSink = {
  async ingestSlate(source, payload) {
    const { rows } = await db.pool.query(`select public.ingest_slate($1, $2::jsonb) as r`, [source, JSON.stringify(payload)]);
    return rows[0].r;
  },
  async ingestResults(source, payload) {
    const { rows } = await db.pool.query(`select public.ingest_results($1, $2::jsonb) as r`, [source, JSON.stringify(payload)]);
    return rows[0].r;
  },
  async matchesAwaitingResults(source, limit) {
    const { rows } = await db.pool.query(`select external_id from public.matches_awaiting_results($1, $2)`, [source, limit]);
    return rows.map((r) => r.external_id);
  },
};

async function demoProvider(now: () => Date) {
  const { rows } = await db.pool.query(`select sport_id, code, components from public.markets`);
  const marketComponents: Record<string, Record<string, string[]>> = {};
  for (const r of rows) (marketComponents[r.sport_id] ??= {})[r.code] = r.components;
  return new DemoProvider({ marketComponents, now });
}

describe("сквозной сценарий Demo Provider → БД → расчёт", () => {
  it("загружает линии, принимает купон, рассчитывает его после симуляции", async () => {
    let now = new Date();
    const provider = await demoProvider(() => now);

    const counts = await syncLines(provider, sink, { now });
    expect(counts.projections).toBeGreaterThan(50);
    // Повторная синхронизация не создаёт дублей.
    await syncLines(provider, sink, { now });
    const { rows: dup } = await db.pool.query(
      `select count(*)::int as n from (select match_id, player_id, market_id from public.projections group by 1,2,3 having count(*) > 1) x`,
    );
    expect(dup[0].n).toBe(0);

    // Купон из трёх линий разных спортсменов ближайшего матча.
    const { rows: selections } = await db.pool.query(
      `select distinct on (p.player_id) p.id, p.line::float as line, m.external_id
         from public.projections p join public.matches m on m.id = p.match_id
        where p.match_id = (
          select m2.id from public.matches m2
           where m2.source = 'demo' and m2.status = 'SCHEDULED' and m2.starts_at > now()
           order by m2.starts_at, m2.id limit 1
        )
        order by p.player_id, p.id
        limit 3`,
    );
    expect(selections).toHaveLength(3);
    const user = await createUser(db.pool);
    const lineup = await asUser(db.pool, user, async (c) => {
      const { rows } = await c.query(
        `select * from public.create_lineup('POWER', $1, $2::jsonb, 5, 'demo-pipeline-key')`,
        [rub(1_000), JSON.stringify(selections.map((s) => ({ projection_id: s.id, direction: "OVER", line: s.line })))],
      );
      return rows[0];
    });
    expect(lineup.status).toBe("PENDING");

    // Пока матч не окончен, плановый запрос результатов ничего не рассчитывает.
    expect(await syncResults(provider, sink)).toMatchObject({ matches: 0 });

    // Администратор вручную «завершает» демо-матч.
    const result = await simulateMatch(provider, sink, selections[0].external_id);
    expect(result).toMatchObject({ matches: 1, lineups_settled: 1 });

    const { rows: settled } = await db.pool.query(
      `select status, payout::bigint from public.lineups where id = $1`,
      [lineup.id],
    );
    expect(["WON", "LOST", "VOID"]).toContain(settled[0].status);
    const w = await wallet(db.pool, user);
    expect(w.reserved).toBe(0);
    expect(w.balance).toBe(rub(99_000) + Number(settled[0].payout));

    // Повторная симуляция не меняет итог.
    await simulateMatch(provider, sink, selections[0].external_id);
    expect(await wallet(db.pool, user)).toEqual(w);

    // Спустя время плановый запрос результатов завершает остальные начавшиеся матчи.
    now = new Date(Date.now() + 4 * 86_400_000);
    await db.pool.query(`update public.matches set starts_at = starts_at - interval '5 days' where source = 'demo'`);
    const later = await syncResults(provider, sink);
    expect(later.matches).toBeGreaterThan(0);
  });
});
