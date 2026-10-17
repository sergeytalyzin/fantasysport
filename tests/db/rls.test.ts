import { describe, expect, it } from "vitest";
import { asUser, createLineup, createMatchWithProjections, createUser, picks, rub, setupTestDatabase } from "./helpers";

const db = setupTestDatabase();

describe("RLS и права доступа", () => {
  it("пользователь видит только свой кошелёк и свои операции", async () => {
    const alice = await createUser(db.pool);
    const bob = await createUser(db.pool);
    await asUser(db.pool, alice, async (c) => {
      const wallets = await c.query(`select user_id from public.wallets`);
      expect(wallets.rows).toEqual([{ user_id: alice }]);
      const txs = await c.query(`select distinct user_id from public.wallet_transactions`);
      expect(txs.rows).toEqual([{ user_id: alice }]);
      const other = await c.query(`select * from public.wallets where user_id = $1`, [bob]);
      expect(other.rows).toHaveLength(0);
    });
  });

  it("гость не видит кошельки", async () => {
    await createUser(db.pool);
    await asUser(db.pool, null, async (c) => {
      const { rows } = await c.query(`select * from public.wallets`);
      expect(rows).toHaveLength(0);
    });
  });

  it.each([
    ["UPDATE своего кошелька", `update public.wallets set balance = 999999999 where user_id = $1`],
    ["INSERT операции", `insert into public.wallet_transactions (user_id, type, amount, balance_after, reserved_after, idempotency_key) values ($1, 'PICK_WIN', 1, 1, 0, 'x')`],
    ["DELETE операций", `delete from public.wallet_transactions where user_id = $1`],
    ["INSERT купона", `insert into public.lineups (user_id, play_type, picks_count, stake, multiplier, potential_payout, payout_snapshot, idempotency_key) values ($1, 'POWER', 2, 1, 3, 3, '[]', 'xxxxxxxx')`],
    ["UPDATE роли", `update public.profiles set role = 'admin' where id = $1`],
    ["INSERT бонуса", `insert into public.monthly_bonus_grants (user_id, year, month, kind, amount) values ($1, 2030, 1, 'MONTHLY', 1)`],
    ["UPDATE линии", `update public.projections set line = 0.5 where $1::uuid is not null`],
  ])("запрещено: %s", async (_, sql) => {
    const user = await createUser(db.pool);
    await expect(asUser(db.pool, user, (c) => c.query(sql, [user]))).rejects.toThrow(/permission denied/);
  });

  it("нельзя изменить чужой кошелёк через RPC", async () => {
    const user = await createUser(db.pool);
    const victim = await createUser(db.pool);
    await expect(
      asUser(db.pool, user, (c) =>
        c.query(`select private.wallet_apply($1::uuid, 'ADMIN_ADJUSTMENT', 100, 0, 'hack')`, [victim]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db.pool, user, (c) => c.query(`select public.admin_adjust_balance($1, 100, 'hack attempt')`, [victim])),
    ).rejects.toThrow(/Доступ только для администраторов/);
    await expect(
      asUser(db.pool, user, (c) => c.query(`select public.ingest_results('oddspapi', '{}'::jsonb)`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("можно изменить свой никнейм, но не чужой", async () => {
    const user = await createUser(db.pool, { nickname: "before_name" });
    const other = await createUser(db.pool, { nickname: "other_name" });
    await asUser(db.pool, user, async (c) => {
      await c.query(`update public.profiles set nickname = 'after_name' where id = $1`, [user]);
      const res = await c.query(`update public.profiles set nickname = 'pwned' where id = $1`, [other]);
      expect(res.rowCount).toBe(0);
    });
    const { rows } = await db.pool.query(
      `select nickname from public.profiles where id = any($1) order by nickname`,
      [[user, other]],
    );
    expect(rows.map((r) => r.nickname)).toEqual(["after_name", "other_name"]);
  });

  it("купоны и выборы видны только владельцу", async () => {
    const owner = await createUser(db.pool);
    const stranger = await createUser(db.pool);
    const { projections } = await createMatchWithProjections(db.pool);
    await createLineup(db.pool, owner, { stake: rub(100), selections: picks(projections.slice(0, 2)), multiplier: 3 });
    await asUser(db.pool, stranger, async (c) => {
      expect((await c.query(`select * from public.lineups`)).rows).toHaveLength(0);
      expect((await c.query(`select * from public.lineup_selections`)).rows).toHaveLength(0);
    });
    await asUser(db.pool, owner, async (c) => {
      expect((await c.query(`select * from public.lineups`)).rows).toHaveLength(1);
      expect((await c.query(`select * from public.lineup_selections`)).rows).toHaveLength(2);
    });
  });

  it("администратор видит все кошельки и журнал аудита", async () => {
    const admin = await createUser(db.pool, { admin: true });
    await createUser(db.pool);
    await asUser(db.pool, admin, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from public.wallets`);
      expect(rows[0].n).toBeGreaterThan(1);
      await c.query(`select * from public.admin_audit_logs`);
    });
  });

  it("обычный пользователь не видит журнал аудита и синхронизаций", async () => {
    const user = await createUser(db.pool);
    await db.pool.query(`insert into public.sync_runs (provider, job) values ('oddspapi', 'sync')`);
    await asUser(db.pool, user, async (c) => {
      expect((await c.query(`select * from public.sync_runs`)).rows).toHaveLength(0);
      expect((await c.query(`select * from public.admin_audit_logs`)).rows).toHaveLength(0);
    });
  });
});
