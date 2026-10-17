import { describe, expect, it } from "vitest";
import {
  asUser,
  createLineup,
  createMatchWithProjections,
  createUser,
  finishMatch,
  picks,
  rub,
  setupTestDatabase,
} from "./helpers";

const db = setupTestDatabase();

function currentMskPeriod() {
  const msk = new Date(Date.now() + 3 * 3600_000);
  return { year: msk.getUTCFullYear(), month: msk.getUTCMonth() + 1 };
}

describe("рейтинги", () => {
  it("общий рейтинг: капитал = баланс + резерв, прибыль без бонусов", async () => {
    const winner = await createUser(db.pool, { nickname: "lb_winner" });
    const pending = await createUser(db.pool, { nickname: "lb_pending" });
    const loser = await createUser(db.pool, { nickname: "lb_loser" });

    const m1 = await createMatchWithProjections(db.pool, { playersCount: 2 });
    await createLineup(db.pool, winner, { stake: rub(10_000), selections: picks(m1.projections), multiplier: 3 });
    await createLineup(db.pool, loser, { stake: rub(10_000), selections: picks(m1.projections, "UNDER"), multiplier: 3 });
    await finishMatch(db.pool, m1.matchId, m1.players, [30, 30]);

    const m2 = await createMatchWithProjections(db.pool, { playersCount: 2 });
    await createLineup(db.pool, pending, { stake: rub(50_000), selections: picks(m2.projections), multiplier: 3 });

    const { rows } = await db.pool.query(
      `select rank::int, nickname, capital::bigint, profit::bigint, lineups_settled, win_rate::float
         from public.get_overall_leaderboard('lb_', 10, 0)`,
    );
    expect(rows).toEqual([
      { rank: 1, nickname: "lb_winner", capital: String(rub(120_000)), profit: String(rub(20_000)), lineups_settled: 1, win_rate: 100 },
      { rank: 2, nickname: "lb_pending", capital: String(rub(100_000)), profit: "0", lineups_settled: 0, win_rate: null },
      { rank: 3, nickname: "lb_loser", capital: String(rub(90_000)), profit: String(-rub(10_000)), lineups_settled: 1, win_rate: 0 },
    ]);

    const me = await asUser(db.pool, loser, (c) => c.query(`select rank::int, total_players::int from public.get_my_overall_rank()`));
    expect(me.rows[0]).toEqual({ rank: 3, total_players: 3 });
  });

  it("месячный рейтинг считает только прибыль рассчитанных прогнозов", async () => {
    const { year, month } = currentMskPeriod();
    const a = await createUser(db.pool, { nickname: "mo_a" });
    const b = await createUser(db.pool, { nickname: "mo_b" });
    // Бонус администратора не влияет на месячный рейтинг.
    await db.pool.query(`select private.wallet_apply($1::uuid, 'ADMIN_ADJUSTMENT', 99900000, 0, 'big-' || $1::text)`, [b]);

    const m = await createMatchWithProjections(db.pool, { playersCount: 2 });
    await createLineup(db.pool, a, { stake: rub(1_000), selections: picks(m.projections), multiplier: 3 });
    await createLineup(db.pool, b, { stake: rub(1_000), selections: picks(m.projections, "UNDER"), multiplier: 3 });
    await finishMatch(db.pool, m.matchId, m.players, [30, 30]);

    const { rows } = await db.pool.query(
      `select rank::int, nickname, profit::bigint, is_archived from public.get_monthly_leaderboard($1, $2, 'mo_', 10, 0)`,
      [year, month],
    );
    // Место глобальное: поиск фильтрует строки, но не пересчитывает места
    // (lb_winner из предыдущего теста заработал в этом месяце больше).
    expect(rows).toEqual([
      { rank: 2, nickname: "mo_a", profit: String(rub(2_000)), is_archived: false },
      { rank: 3, nickname: "mo_b", profit: String(-rub(1_000)), is_archived: false },
    ]);
  });

  it("архив прошлых месяцев фиксируется снимком и не меняется", async () => {
    const u1 = await createUser(db.pool, { nickname: "arch_one" });
    const u2 = await createUser(db.pool, { nickname: "arch_two" });
    await db.pool.query(
      `insert into public.monthly_user_stats (user_id, year, month, lineups_settled, lineups_won, staked, payout)
       values ($1, 2025, 12, 3, 2, 300000, 900000), ($2, 2025, 12, 1, 0, 100000, 0)`,
      [u1, u2],
    );
    const { rows: n } = await db.pool.query(`select private.snapshot_monthly_leaderboards() as n`);
    expect(n[0].n).toBeGreaterThanOrEqual(2);
    // Повторный запуск идемпотентен, а изменение «живых» данных не влияет на архив.
    await db.pool.query(`select private.snapshot_monthly_leaderboards()`);
    await db.pool.query(`update public.monthly_user_stats set payout = 0 where user_id = $1 and year = 2025`, [u1]);

    const { rows } = await db.pool.query(
      `select rank::int, nickname, profit::bigint, is_archived from public.get_monthly_leaderboard(2025, 12, 'arch_', 10, 0)`,
    );
    expect(rows).toEqual([
      { rank: 1, nickname: "arch_one", profit: "600000", is_archived: true },
      { rank: 2, nickname: "arch_two", profit: "-100000", is_archived: true },
    ]);

    const periods = await db.pool.query(`select year, month, is_current from public.get_leaderboard_periods()`);
    expect(periods.rows[0].is_current).toBe(true);
    expect(periods.rows).toContainEqual({ year: 2025, month: 12, is_current: false });
  });

  it("пагинация и поиск", async () => {
    for (let i = 0; i < 5; i++) await createUser(db.pool, { nickname: `page_${i}` });
    const p1 = await db.pool.query(`select nickname from public.get_overall_leaderboard('page_', 2, 0)`);
    const p2 = await db.pool.query(`select nickname from public.get_overall_leaderboard('page_', 2, 2)`);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(2);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.nickname)).size).toBe(4);
    // Спецсимволы LIKE экранируются.
    const none = await db.pool.query(`select * from public.get_overall_leaderboard('%%%', 10, 0)`);
    expect(none.rows).toHaveLength(0);
  });

  it("сводка профиля", async () => {
    const user = await createUser(db.pool, { nickname: "summary_me" });
    const { rows } = await asUser(db.pool, user, (c) => c.query(`select * from public.get_my_profile_summary()`));
    expect(rows[0]).toMatchObject({ nickname: "summary_me", balance: String(rub(100_000)), profit: "0", lineups_total: 0 });
  });
});

describe("административные функции", () => {
  it("корректировка баланса журналируется", async () => {
    const admin = await createUser(db.pool, { admin: true });
    const user = await createUser(db.pool);
    await asUser(db.pool, admin, (c) => c.query(`select public.admin_adjust_balance($1, 500000, 'Компенсация')`, [user]));
    const { rows } = await db.pool.query(
      `select action, admin_id, payload ->> 'amount' as amount from public.admin_audit_logs where target_id = $1`,
      [user],
    );
    expect(rows).toEqual([{ action: "wallet.adjust", admin_id: admin, amount: "500000" }]);
    const tx = await db.pool.query(
      `select created_by from public.wallet_transactions where user_id = $1 and type = 'ADMIN_ADJUSTMENT'`,
      [user],
    );
    expect(tx.rows[0].created_by).toBe(admin);
  });

  it("подтверждение результатов запускает расчёт", async () => {
    const admin = await createUser(db.pool, { admin: true });
    const user = await createUser(db.pool);
    const m = await createMatchWithProjections(db.pool, { playersCount: 2 });
    const lineup = await createLineup(db.pool, user, { stake: rub(1_000), selections: picks(m.projections), multiplier: 3 });
    await asUser(db.pool, admin, async (c) => {
      await c.query(`select public.admin_set_match_status($1, 'FINISHED', 3::smallint, 2::smallint)`, [m.matchId]);
      for (const p of m.players) {
        await c.query(`select public.admin_upsert_player_stats($1, $2, '{"points": 25}'::jsonb, true)`, [m.matchId, p]);
      }
      const { rows } = await c.query(`select public.admin_confirm_match_results($1) as n`, [m.matchId]);
      expect(rows[0].n).toBe(1);
    });
    const { rows } = await db.pool.query(`select status from public.lineups where id = $1`, [lineup.id]);
    expect(rows[0].status).toBe("WON");
    await expect(
      asUser(db.pool, admin, (c) =>
        c.query(`select public.admin_upsert_player_stats($1, $2, '{"points": 1}'::jsonb, true)`, [m.matchId, m.players[0]]),
      ),
    ).rejects.toThrow(/уже подтверждена/);
  });

  it("настройки проверяют тип значения", async () => {
    const admin = await createUser(db.pool, { admin: true });
    await expect(
      asUser(db.pool, admin, (c) => c.query(`select public.admin_update_setting('min_stake', '"abc"'::jsonb)`)),
    ).rejects.toThrow(/Неверный тип/);
  });
});
