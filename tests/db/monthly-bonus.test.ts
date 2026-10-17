import { describe, expect, it } from "vitest";
import { createUser, rub, setupTestDatabase, wallet } from "./helpers";

const db = setupTestDatabase();

async function grant(now: string) {
  const { rows } = await db.pool.query(
    `select private.grant_monthly_bonuses($1::timestamptz) as n`,
    [now],
  );
  return rows[0].n as number;
}

async function grants(userId: string) {
  const { rows } = await db.pool.query(
    `select year, month, kind from public.monthly_bonus_grants where user_id = $1 order by year, month`,
    [userId],
  );
  return rows.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}:${r.kind}`);
}

describe("ежемесячный бонус", () => {
  it("прибавляется к балансу без сброса и начисляется один раз за месяц", async () => {
    const id = await createUser(db.pool, { createdAt: "2026-01-15T10:00:00+03:00" });
    // Пользователь «заработал» 150 000 ₽.
    await db.pool.query(
      `select private.wallet_apply($1::uuid, 'PICK_WIN', 15000000, 0, 'earn-' || $1::text)`,
      [id],
    );
    expect((await wallet(db.pool, id)).balance).toBe(rub(250_000));

    // 1 февраля 00:00 МСК = 31 января 21:00 UTC.
    await grant("2026-01-31T21:00:00Z");
    expect((await wallet(db.pool, id)).balance).toBe(rub(350_000));

    // Повторные запуски в том же месяце ничего не начисляют.
    await grant("2026-01-31T21:00:00Z");
    await grant("2026-02-14T12:00:00Z");
    expect((await wallet(db.pool, id)).balance).toBe(rub(350_000));

    await db.pool.query(
      `select private.wallet_apply($1::uuid, 'PICK_WIN', 5000000, 0, 'earn2-' || $1::text)`,
      [id],
    );
    await grant("2026-02-28T21:00:00Z"); // 1 марта 00:00 МСК
    expect((await wallet(db.pool, id)).balance).toBe(rub(500_000));
    expect(await grants(id)).toEqual(["2026-01:REGISTRATION", "2026-02:MONTHLY", "2026-03:MONTHLY"]);
  });

  it("за минуту до полуночи по Москве бонус ещё не начисляется", async () => {
    const id = await createUser(db.pool, { createdAt: "2026-03-10T10:00:00+03:00" });
    await grant("2026-03-31T20:59:00Z"); // 31 марта 23:59 МСК
    expect(await grants(id)).toEqual(["2026-03:REGISTRATION"]);
    await grant("2026-03-31T21:00:00Z"); // 1 апреля 00:00 МСК
    expect(await grants(id)).toEqual(["2026-03:REGISTRATION", "2026-04:MONTHLY"]);
  });

  it("регистрация 1-го числа не приводит к двойному начислению", async () => {
    // 1 мая 00:05 МСК — уже после планового запуска.
    const id = await createUser(db.pool, { createdAt: "2026-04-30T21:05:00Z" });
    await grant("2026-04-30T21:10:00Z");
    await grant("2026-05-20T12:00:00Z");
    expect((await wallet(db.pool, id)).balance).toBe(rub(100_000));
    expect(await grants(id)).toEqual(["2026-05:REGISTRATION"]);
  });

  it("восстанавливает все пропущенные месяцы после простоя", async () => {
    const id = await createUser(db.pool, { createdAt: "2025-10-05T12:00:00+03:00" });
    await grant("2026-01-10T12:00:00Z");
    expect(await grants(id)).toEqual([
      "2025-10:REGISTRATION",
      "2025-11:MONTHLY",
      "2025-12:MONTHLY",
      "2026-01:MONTHLY",
    ]);
    expect((await wallet(db.pool, id)).balance).toBe(rub(400_000));
  });

  it("не учитывается как прибыль (funded_total растёт вместе с балансом)", async () => {
    const id = await createUser(db.pool, { createdAt: "2026-06-10T12:00:00+03:00" });
    await grant("2026-07-02T12:00:00Z");
    const w = await wallet(db.pool, id);
    expect(w.capital - w.fundedTotal).toBe(0);
  });

  it("сумма берётся из настроек и выключается флагом", async () => {
    const id = await createUser(db.pool, { createdAt: "2026-08-10T12:00:00+03:00" });
    await db.pool.query(`update public.app_settings set value = 'false' where key = 'monthly_bonus_enabled'`);
    await grant("2026-09-02T12:00:00Z");
    expect(await grants(id)).toEqual(["2026-08:REGISTRATION"]);
    await db.pool.query(`update public.app_settings set value = 'true' where key = 'monthly_bonus_enabled'`);
    await db.pool.query(`update public.app_settings set value = '5000000' where key = 'monthly_bonus_amount'`);
    await grant("2026-09-02T12:00:00Z");
    expect((await wallet(db.pool, id)).balance).toBe(rub(150_000));
    await db.pool.query(`update public.app_settings set value = '10000000' where key = 'monthly_bonus_amount'`);
  });
});
