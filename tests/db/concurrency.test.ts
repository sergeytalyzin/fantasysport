import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLineup,
  createMatchWithProjections,
  createUser,
  finishMatch,
  picks,
  rub,
  setupTestDatabase,
  wallet,
} from "./helpers";

const db = setupTestDatabase();

describe("конкурентные операции", () => {
  it("параллельные купоны не уводят баланс в минус", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    // 10 параллельных купонов по 30 000 ₽ при балансе 100 000 ₽ → пройдут ровно 3.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        createLineup(db.pool, user, {
          stake: rub(30_000),
          selections: picks(projections.slice(0, 2)),
          multiplier: 3,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(3);
    expect(failed.every((r) => /Недостаточно/.test(String(r.reason)))).toBe(true);
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(10_000), reserved: rub(90_000) });
  });

  it("параллельные запросы с одним ключом создают один купон", async () => {
    const user = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    const key = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createLineup(db.pool, user, {
          stake: rub(1_000),
          selections: picks(projections.slice(0, 2)),
          multiplier: 3,
          key,
        }),
      ),
    );
    // Проигравшие гонку получают ошибку уникальности либо уже созданный купон.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const { rows } = await db.pool.query(`select count(*)::int as n from public.lineups where user_id = $1`, [user]);
    expect(rows[0].n).toBe(1);
    expect((await wallet(db.pool, user)).balance).toBe(rub(99_000));
  });

  it("параллельный запуск ежемесячного бонуса начисляет один раз", async () => {
    const user = await createUser(db.pool, { createdAt: "2026-02-10T12:00:00+03:00" });
    await Promise.all(
      Array.from({ length: 6 }, () =>
        db.pool.query(`select private.grant_monthly_bonuses('2026-03-05T12:00:00Z')`),
      ),
    );
    expect((await wallet(db.pool, user)).balance).toBe(rub(200_000));
  });

  it("параллельный расчёт матча начисляет выигрыш один раз", async () => {
    const user = await createUser(db.pool);
    const match = await createMatchWithProjections(db.pool, { playersCount: 2 });
    await createLineup(db.pool, user, { stake: rub(1_000), selections: picks(match.projections), multiplier: 3 });
    await finishMatch(db.pool, match.matchId, match.players, [30, 30]);
    await Promise.all(
      Array.from({ length: 6 }, () => db.pool.query(`select private.settle_match($1)`, [match.matchId])),
    );
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(102_000), reserved: 0 });
  });

  it("параллельные корректировки сохраняют согласованность журнала", async () => {
    const user = await createUser(db.pool);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.pool.query(`select private.wallet_apply($1::uuid, 'ADMIN_ADJUSTMENT', 100, 0, $2)`, [user, `adj-${i}-${user}`]),
      ),
    );
    const { rows } = await db.pool.query(
      `select max(balance_after)::bigint as last, sum(amount)::bigint as total
         from public.wallet_transactions where user_id = $1`,
      [user],
    );
    expect(Number(rows[0].last)).toBe(rub(100_000) + 2_000);
    expect(Number(rows[0].total)).toBe(rub(100_000) + 2_000);
  });
});
