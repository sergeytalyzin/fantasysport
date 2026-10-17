import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLineup,
  createMatchWithProjections,
  createUser,
  picks,
  rub,
  setupTestDatabase,
  wallet,
} from "./helpers";

const db = setupTestDatabase();

describe("создание купона", () => {
  it("списывает сумму, резервирует её и сохраняет снимок условий", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    const lineup = await createLineup(db.pool, user, {
      stake: rub(1_000),
      selections: picks(projections.slice(0, 3)),
      multiplier: 5,
    });

    expect(lineup.status).toBe("PENDING");
    expect(Number(lineup.potential_payout)).toBe(rub(5_000));
    expect(lineup.payout_snapshot).toEqual([
      { picks_count: 2, correct_count: 2, multiplier: 3 },
      { picks_count: 3, correct_count: 3, multiplier: 5 },
    ]);
    expect(await wallet(db.pool, user)).toMatchObject({
      balance: rub(99_000),
      reserved: rub(1_000),
      capital: rub(100_000),
    });

    const { rows } = await db.pool.query(
      `select line::float, direction, player_name, market_name, league_code
         from public.lineup_selections where lineup_id = $1`,
      [lineup.id],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ line: 20.5, direction: "OVER", market_name: "Очки", league_code: "NBA" });
  });

  it("повторная отправка с тем же ключом не списывает сумму дважды", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    const key = randomUUID();
    const args = { stake: rub(500), selections: picks(projections.slice(0, 2)), multiplier: 3, key };
    const first = await createLineup(db.pool, user, args);
    const second = await createLineup(db.pool, user, args);
    expect(second.id).toBe(first.id);
    expect((await wallet(db.pool, user)).balance).toBe(rub(99_500));
  });

  it("отклоняет купон при недостаточном балансе", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    await db.pool.query(
      `select private.wallet_apply($1::uuid, 'ADMIN_ADJUSTMENT', -9990000, 0, 'drain-' || $1::text)`,
      [user],
    );
    await expect(
      createLineup(db.pool, user, { stake: rub(500), selections: picks(projections.slice(0, 2)), multiplier: 3 }),
    ).rejects.toThrow(/Недостаточно/);
    const { rows } = await db.pool.query(`select count(*)::int as n from public.lineups where user_id = $1`, [user]);
    expect(rows[0].n).toBe(0);
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(100), reserved: 0 });
  });

  it.each([
    ["1 выбор", 1, "POWER", 3, /от 2 до 6/],
    ["7 выборов", 7, "POWER", 3, /от 2 до 6/],
    ["Flex из 2", 2, "FLEX", 3, /Flex Play доступен от 3/],
  ] as const)("отклоняет некорректное число выборов: %s", async (_, count, playType, mult, error) => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool, { playersCount: 7 });
    await expect(
      createLineup(db.pool, user, {
        playType,
        stake: rub(100),
        selections: picks(projections.slice(0, count)),
        multiplier: mult,
      }),
    ).rejects.toThrow(error);
  });

  it("запрещает противоположные исходы одной линии", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    const p = projections[0];
    const selections = JSON.stringify([
      { projection_id: p.id, direction: "OVER", line: p.line },
      { projection_id: p.id, direction: "UNDER", line: p.line },
    ]);
    await expect(
      createLineup(db.pool, user, { stake: rub(100), selections, multiplier: 3 }),
    ).rejects.toThrow(/противоположные/);
  });

  it("отклоняет купон, если линия изменилась", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    await db.pool.query(`update public.projections set line = 22.5 where id = $1`, [projections[0].id]);
    await expect(
      createLineup(db.pool, user, { stake: rub(100), selections: picks(projections.slice(0, 2)), multiplier: 3 }),
    ).rejects.toThrow(/изменилась: 20\.5 → 22\.5/);
  });

  it("отклоняет купон на начавшийся матч и приостановленную линию", async () => {
    const user = await createUser(db.pool);
    const started = await createMatchWithProjections(db.pool, { startsInMinutes: -1 });
    await expect(
      createLineup(db.pool, user, { stake: rub(100), selections: picks(started.projections.slice(0, 2)), multiplier: 3 }),
    ).rejects.toThrow(/закрыт/);

    const suspended = await createMatchWithProjections(db.pool);
    await db.pool.query(`update public.projections set status = 'SUSPENDED' where id = $1`, [
      suspended.projections[1].id,
    ]);
    await expect(
      createLineup(db.pool, user, { stake: rub(100), selections: picks(suspended.projections.slice(0, 2)), multiplier: 3 }),
    ).rejects.toThrow(/закрыт/);
  });

  it("проверяет множитель на сервере", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    await expect(
      createLineup(db.pool, user, { stake: rub(100), selections: picks(projections.slice(0, 2)), multiplier: 100 }),
    ).rejects.toThrow(/Множитель изменился: теперь ×3/);
  });

  it("проверяет допустимую сумму", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    for (const stake of [rub(50), rub(100_001), 10_050]) {
      await expect(
        createLineup(db.pool, user, { stake, selections: picks(projections.slice(0, 2)), multiplier: 3 }),
      ).rejects.toThrow(/Сумма должна быть/);
    }
  });

  it("требует авторизацию", async () => {
    const { projections } = await createMatchWithProjections(db.pool);
    const client = await db.pool.connect();
    try {
      await expect(
        client.query(`select public.create_lineup('POWER', 10000, $1::jsonb, 3, $2)`, [
          picks(projections.slice(0, 2)),
          randomUUID(),
        ]),
      ).rejects.toThrow(/Войдите/);
    } finally {
      client.release();
    }
  });
});
