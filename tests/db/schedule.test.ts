import { describe, expect, it } from "vitest";
import { setupTestDatabase } from "./helpers";

const db = setupTestDatabase();

const ingest = async (payload: unknown) =>
  (await db.pool.query(`select public.ingest_schedule('oddspapi', $1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;

const team = (id: string, sport = "football") => ({ external_id: `oddspapi:participant:${id}`, sport_id: sport, name: `Team ${id}`, short_name: `T${id}`, abbr: `T${id}` });
const match = (id: string, tid: string, h: string, a: string, status = "SCHEDULED", inHours = 5) => ({
  external_id: id,
  tournament_id: tid,
  home_team_external_id: `oddspapi:participant:${h}`,
  away_team_external_id: `oddspapi:participant:${a}`,
  starts_at: new Date(Date.now() + inHours * 3600_000).toISOString(),
  status,
});

describe("полное расписание", () => {
  it("создаёт турниры автоматически и кладёт известные лиги в существующие", async () => {
    const r = await ingest({
      leagues: [
        { tournament_id: "9001", sport_id: "football", name: "Primera Division", country: "Chile" },
        { tournament_id: "234", sport_id: "hockey", name: "NHL", country: "USA" },
      ],
      teams: [team("1"), team("2"), team("10", "hockey"), team("11", "hockey")],
      matches: [match("f1", "9001", "1", "2"), match("h1", "234", "10", "11")],
    });
    expect(r).toMatchObject({ leagues: 1, teams: 4, matches: 2 });

    const { rows } = await db.pool.query(
      `select m.external_id, l.code, l.sport_id, l.name, l.country from public.matches m join public.leagues l on l.id = m.league_id where m.source = 'oddspapi' order by 1`,
    );
    expect(rows).toEqual([
      { external_id: "f1", code: "OP_9001", sport_id: "football", name: "Primera Division", country: "Chile" },
      { external_id: "h1", code: "NHL", sport_id: "hockey", name: "Национальная хоккейная лига", country: "США/Канада" },
    ]);
  });

  it("повторная загрузка обновляет статус и время, но не трогает завершённые матчи", async () => {
    await ingest({ leagues: [], teams: [], matches: [match("f1", "9001", "1", "2", "LIVE", 0)] });
    await db.pool.query(`update public.matches set status = 'FINISHED' where external_id = 'h1'`);
    const r = await ingest({ leagues: [], teams: [], matches: [match("h1", "234", "10", "11", "SCHEDULED", 8)] });
    expect(r.matches).toBe(0);
    const { rows } = await db.pool.query(`select external_id, status from public.matches where source = 'oddspapi' order by 1`);
    expect(rows).toEqual([
      { external_id: "f1", status: "LIVE" },
      { external_id: "h1", status: "FINISHED" },
    ]);
  });

  it("неизвестный вид спорта и матч команды с самой собой не загружаются", async () => {
    const r = await ingest({
      leagues: [{ tournament_id: "9100", sport_id: "quidditch", name: "X", country: null }],
      teams: [team("50")],
      matches: [match("bad", "9001", "50", "50")],
    });
    expect(r).toMatchObject({ leagues: 0, matches: 0 });
  });

  it("недоступно клиентам", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("set role authenticated");
      await expect(client.query(`select public.ingest_schedule('oddspapi', '{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("reset role");
      client.release();
    }
  });
});
