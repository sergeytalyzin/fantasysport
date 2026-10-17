import { describe, expect, it } from "vitest";
import { createUser, rub, setupTestDatabase, wallet } from "./helpers";

const db = setupTestDatabase();

describe("регистрация и стартовый бонус", () => {
  it("создаёт профиль, кошелёк и начисляет 100 000 ₽", async () => {
    const id = await createUser(db.pool, { nickname: "Ovi_8" });

    const { rows: profile } = await db.pool.query(
      `select nickname, role from public.profiles where id = $1`,
      [id],
    );
    expect(profile[0]).toEqual({ nickname: "Ovi_8", role: "user" });

    expect(await wallet(db.pool, id)).toEqual({
      balance: rub(100_000),
      reserved: 0,
      capital: rub(100_000),
      fundedTotal: rub(100_000),
    });

    const { rows: txs } = await db.pool.query(
      `select type, amount::bigint as amount from public.wallet_transactions where user_id = $1`,
      [id],
    );
    expect(txs).toEqual([{ type: "INITIAL_BONUS", amount: String(rub(100_000)) }]);
  });

  it("стартовый бонус защищён от повторного начисления", async () => {
    const id = await createUser(db.pool);
    // Повтор с тем же ключом идемпотентности возвращает существующую операцию.
    await db.pool.query(
      `select private.wallet_apply($1::uuid, 'INITIAL_BONUS', 10000000, 0, 'initial_bonus:' || $1::text)`,
      [id],
    );
    expect((await wallet(db.pool, id)).balance).toBe(rub(100_000));
    const { rows } = await db.pool.query(
      `select count(*)::int as n from public.wallet_transactions where user_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("подбирает уникальный никнейм при совпадении и генерирует его при пустом", async () => {
    const a = await createUser(db.pool, { nickname: "Kucherov" });
    const b = await createUser(db.pool, { nickname: "kucherov" });
    const c = await createUser(db.pool);
    const { rows } = await db.pool.query(
      `select id, nickname from public.profiles where id = any($1)`,
      [[a, b, c]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.nickname]));
    expect(byId[a]).toBe("Kucherov");
    expect(byId[b]).toMatch(/^kucherov_[0-9a-f]{4}$/);
    expect(byId[c]).toMatch(/^player_[0-9a-f]{6}$/);
  });

  it("месяц регистрации отмечен как закрытый", async () => {
    const id = await createUser(db.pool);
    const { rows } = await db.pool.query(
      `select kind, amount::bigint as amount from public.monthly_bonus_grants where user_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ kind: "REGISTRATION", amount: String(rub(100_000)) }]);
  });
});

describe("операции кошелька", () => {
  it("не допускает отрицательный баланс", async () => {
    const id = await createUser(db.pool);
    await expect(
      db.pool.query(
        `select private.wallet_apply($1::uuid, 'ADMIN_ADJUSTMENT', -20000000, 0, 'neg-' || $1::text)`,
        [id],
      ),
    ).rejects.toThrow(/Недостаточно/);
    expect((await wallet(db.pool, id)).balance).toBe(rub(100_000));
  });

  it("проверяет знак суммы по типу операции", async () => {
    const id = await createUser(db.pool);
    await expect(
      db.pool.query(
        `select private.wallet_apply($1::uuid, 'PICK_WIN', -100, 0, 'sign-' || $1::text)`,
        [id],
      ),
    ).rejects.toThrow(/wallet_transactions_amount_sign/);
  });
});
