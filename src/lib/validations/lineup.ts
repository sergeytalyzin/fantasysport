import { z } from "zod";
import type { AppSettings } from "@/types/domain";

/** Сумма купона в рублях (целое число) в пределах настроек платформы. */
export function stakeSchema(settings: Pick<AppSettings, "min_stake" | "max_stake">, balance: number | null) {
  const min = settings.min_stake / 100;
  const max = settings.max_stake / 100;
  return z
    .number({ message: "Введите сумму" })
    .int("Только целое число рублей")
    .min(min, `Минимум ${min.toLocaleString("ru-RU")} ₽`)
    .max(max, `Максимум ${max.toLocaleString("ru-RU")} ₽`)
    .refine((v) => balance === null || v * 100 <= balance, "Недостаточно средств на балансе");
}
