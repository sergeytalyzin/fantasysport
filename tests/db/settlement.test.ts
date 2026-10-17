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

async function lineupRow(id: string) {
  const { rows } = await db.pool.query(
    `select status, payout::bigint as payout, applied_multiplier::float as mult from public.lineups where id = $1`,
    [id],
  );
  return { status: rows[0].status, payout: Number(rows[0].payout), mult: rows[0].mult };
}

async function setup(count: number, playType: "POWER" | "FLEX", multiplier: number) {
  const user = await createUser(db.pool);
  const match = await createMatchWithProjections(db.pool, { playersCount: count });
  const lineup = await createLineup(db.pool, user, {
    playType,
    stake: rub(1_000),
    selections: picks(match.projections),
    multiplier,
  });
  return { user, match, lineup };
}

describe("расчёт Power Play", () => {
  it("выигрыш: все выборы сыграли — выплата ×5 и снятие резерва", async () => {
    const { user, match, lineup } = await setup(3, "POWER", 5);
    expect(await finishMatch(db.pool, match.matchId, match.players, [25, 30, 21])).toBe(1);
    expect(await lineupRow(lineup.id)).toEqual({ status: "WON", payout: rub(5_000), mult: 5 });
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(104_000), reserved: 0 });
  });

  it("проигрыш: один выбор не сыграл — выплата 0, резерв снят", async () => {
    const { user, match, lineup } = await setup(3, "POWER", 5);
    await finishMatch(db.pool, match.matchId, match.players, [25, 30, 10]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "LOST", payout: 0, mult: 0 });
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(99_000), reserved: 0, capital: rub(99_000) });
  });

  it("6 выборов — ×37,5", async () => {
    const { match, lineup } = await setup(6, "POWER", 37.5);
    await finishMatch(db.pool, match.matchId, match.players, [21, 22, 23, 24, 25, 26]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "WON", payout: rub(37_500), mult: 37.5 });
  });

  it("неучастие спортсмена понижает купон: 3 → 2 выбора, ×3", async () => {
    const { match, lineup } = await setup(3, "POWER", 5);
    await finishMatch(db.pool, match.matchId, match.players, [25, 30, null]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "WON", payout: rub(3_000), mult: 3 });
    const { rows } = await db.pool.query(
      `select result, result_reason from public.lineup_selections where lineup_id = $1 and result = 'VOID'`,
      [lineup.id],
    );
    expect(rows).toEqual([{ result: "VOID", result_reason: "Спортсмен не принял участия в матче" }]);
  });

  it("равенство линии (push) считается как аннулированный выбор", async () => {
    const user = await createUser(db.pool);
    const match = await createMatchWithProjections(db.pool, { playersCount: 3, line: 20 });
    const lineup = await createLineup(db.pool, user, {
      stake: rub(1_000),
      selections: picks(match.projections),
      multiplier: 5,
    });
    await finishMatch(db.pool, match.matchId, match.players, [25, 20, 30]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "WON", payout: rub(3_000), mult: 3 });
  });

  it("меньше 2 действительных выборов — полный возврат (VOID)", async () => {
    const { user, match, lineup } = await setup(2, "POWER", 3);
    await finishMatch(db.pool, match.matchId, match.players, [25, null]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "VOID", payout: rub(1_000), mult: 1 });
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(100_000), reserved: 0 });
    const { rows } = await db.pool.query(
      `select type from public.wallet_transactions where lineup_id = $1 order by id`,
      [lineup.id],
    );
    expect(rows.map((r) => r.type)).toEqual(["PICK_STAKE", "PICK_REFUND"]);
  });

  it("отсутствие статистики по показателю аннулирует выбор", async () => {
    const { match, lineup } = await setup(3, "POWER", 5);
    await db.pool.query(
      `insert into public.player_statistics (match_id, player_id, stats, source)
       values ($1, $2, '{"rebounds": 5}', 'test')`,
      [match.matchId, match.players[2]],
    );
    await finishMatch(db.pool, match.matchId, match.players, [25, 30]);
    expect(await lineupRow(lineup.id)).toMatchObject({ status: "WON", mult: 3 });
    const { rows } = await db.pool.query(
      `select result_reason from public.lineup_selections where lineup_id = $1 and player_id = $2`,
      [lineup.id, match.players[2]],
    );
    expect(rows[0].result_reason).toBe("Нет статистики по показателю");
  });
});

describe("расчёт Flex Play", () => {
  it("5 из 5 — ×10", async () => {
    const { match, lineup } = await setup(5, "FLEX", 10);
    await finishMatch(db.pool, match.matchId, match.players, [21, 22, 23, 24, 25]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "WON", payout: rub(10_000), mult: 10 });
  });

  it("4 из 5 — частичный выигрыш ×2", async () => {
    const { user, match, lineup } = await setup(5, "FLEX", 10);
    await finishMatch(db.pool, match.matchId, match.players, [21, 22, 23, 24, 5]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "PARTIALLY_WON", payout: rub(2_000), mult: 2 });
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(101_000), reserved: 0 });
  });

  it("3 из 5 — ×0,4 (выплата меньше суммы, но это частичный выигрыш)", async () => {
    const { match, lineup } = await setup(5, "FLEX", 10);
    await finishMatch(db.pool, match.matchId, match.players, [21, 22, 23, 4, 5]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "PARTIALLY_WON", payout: rub(400), mult: 0.4 });
  });

  it("2 из 5 — проигрыш", async () => {
    const { match, lineup } = await setup(5, "FLEX", 10);
    await finishMatch(db.pool, match.matchId, match.players, [21, 22, 3, 4, 5]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "LOST", payout: 0, mult: 0 });
  });

  it("использует снимок множителей, а не текущие значения", async () => {
    const { match, lineup } = await setup(4, "FLEX", 6);
    await db.pool.query(
      `update public.payout_rules set multiplier = 100 where play_type = 'FLEX' and picks_count = 4 and correct_count = 4`,
    );
    await finishMatch(db.pool, match.matchId, match.players, [21, 22, 23, 24]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "WON", payout: rub(6_000), mult: 6 });
    await db.pool.query(
      `update public.payout_rules set multiplier = 6 where play_type = 'FLEX' and picks_count = 4 and correct_count = 4`,
    );
  });
});

describe("жизненный цикл матча", () => {
  it("не рассчитывает прогнозы без подтверждённой статистики", async () => {
    const { match, lineup } = await setup(2, "POWER", 3);
    await db.pool.query(
      `insert into public.player_statistics (match_id, player_id, stats, source)
       values ($1, $2, '{"points": 30}', 'test'), ($1, $3, '{"points": 30}', 'test')`,
      [match.matchId, match.players[0], match.players[1]],
    );
    await db.pool.query(`update public.matches set status = 'FINISHED' where id = $1`, [match.matchId]);
    const { rows } = await db.pool.query(`select private.settle_match($1) as n`, [match.matchId]);
    expect(rows[0].n).toBe(0);
    expect((await lineupRow(lineup.id)).status).toBe("PENDING");
  });

  it("отмена матча возвращает сумму", async () => {
    const { user, match, lineup } = await setup(3, "POWER", 5);
    await db.pool.query(`update public.matches set status = 'CANCELLED' where id = $1`, [match.matchId]);
    await db.pool.query(`select private.settle_match($1)`, [match.matchId]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "VOID", payout: rub(1_000), mult: 1 });
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(100_000), reserved: 0 });
  });

  it("купон из нескольких матчей ждёт результата всех матчей", async () => {
    const user = await createUser(db.pool);
    const a = await createMatchWithProjections(db.pool, { playersCount: 1 });
    const b = await createMatchWithProjections(db.pool, { playersCount: 1 });
    const lineup = await createLineup(db.pool, user, {
      stake: rub(1_000),
      selections: picks([...a.projections, ...b.projections]),
      multiplier: 3,
    });
    await finishMatch(db.pool, a.matchId, a.players, [30]);
    expect((await lineupRow(lineup.id)).status).toBe("PENDING");
    await finishMatch(db.pool, b.matchId, b.players, [30]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "WON", payout: rub(3_000), mult: 3 });
  });

  it("повторный расчёт и повторный приём результатов не начисляют выигрыш дважды", async () => {
    const { user, match, lineup } = await setup(2, "POWER", 3);
    await finishMatch(db.pool, match.matchId, match.players, [30, 30]);
    const after = await wallet(db.pool, user);

    await db.pool.query(`select private.settle_match($1)`, [match.matchId]);
    await db.pool.query(`select private.settle_lineup($1)`, [lineup.id]);
    await db.pool.query(`select private.settle_ready_matches()`);
    // Провайдер прислал «новую» статистику уже после подтверждения — игнорируется.
    const { rows: ext } = await db.pool.query(`select external_id from public.matches where id = $1`, [match.matchId]);
    await db.pool.query(
      `select public.ingest_results('test', $1::jsonb)`,
      [JSON.stringify({ matches: [{ external_id: ext[0].external_id, status: "FINISHED", confirmed: true, players: [] }] })],
    );

    expect(await wallet(db.pool, user)).toEqual(after);
    const { rows } = await db.pool.query(
      `select count(*)::int as n from public.wallet_transactions where lineup_id = $1 and type = 'PICK_WIN'`,
      [lineup.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("ручной возврат администратором", async () => {
    const { user, lineup } = await setup(2, "POWER", 3);
    await db.pool.query(`select private.refund_lineup($1, 'Тест')`, [lineup.id]);
    expect(await lineupRow(lineup.id)).toEqual({ status: "REFUNDED", payout: rub(1_000), mult: 1 });
    expect(await wallet(db.pool, user)).toMatchObject({ balance: rub(100_000), reserved: 0 });
    await expect(db.pool.query(`select private.refund_lineup($1, 'Тест')`, [lineup.id])).rejects.toThrow(
      /уже рассчитан/,
    );
  });

  it("сохраняет фактическое значение для проверки результата", async () => {
    const { match, lineup } = await setup(2, "POWER", 3);
    await finishMatch(db.pool, match.matchId, match.players, [31, 12]);
    const { rows } = await db.pool.query(
      `select actual_value::float as v, result from public.lineup_selections where lineup_id = $1 order by actual_value desc`,
      [lineup.id],
    );
    expect(rows).toEqual([
      { v: 31, result: "WIN" },
      { v: 12, result: "LOSS" },
    ]);
  });
});
