"use client";

import { ArrowDown, ArrowUp, Ban, Calculator, Coins, Gift, ListChecks, Trophy } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAppSettings, usePayoutRules } from "@/features/sports/hooks";
import { formatMultiplier, formatRub } from "@/lib/format";
import type { PayoutRule } from "@/types/domain";

// Значения по умолчанию совпадают с app_settings; на странице — актуальные из БД.
const DEFAULTS = {
  initial_bonus_amount: 10_000_000,
  monthly_bonus_amount: 10_000_000,
  min_stake: 10_000,
  max_stake: 10_000_000,
  min_picks: 2,
  max_picks: 6,
  flex_min_picks: 3,
};

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/[0.07] bg-surface-1 p-5 sm:p-6">
      <h2 className="flex items-center gap-2.5 text-lg font-extrabold">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        {title}
      </h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="numeric flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground">
        {n}
      </span>
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </li>
  );
}

function PowerTable({ rules }: { rules: PayoutRule[] }) {
  const rows = rules.filter((r) => r.play_type === "POWER" && r.is_active).sort((a, b) => a.picks_count - b.picks_count);
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-white/10 bg-surface-2 px-3 py-2.5 text-center">
          <p className="text-xs">{r.picks_count} из {r.picks_count}</p>
          <p className="numeric text-lg font-extrabold text-primary">{formatMultiplier(Number(r.multiplier))}</p>
        </div>
      ))}
    </div>
  );
}

function FlexTable({ rules }: { rules: PayoutRule[] }) {
  const active = rules.filter((r) => r.play_type === "FLEX" && r.is_active);
  const counts = [...new Set(active.map((r) => r.picks_count))].sort((a, b) => a - b);
  if (counts.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Выборов</th>
            <th className="px-3 py-2 font-semibold">Угадано → множитель</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {counts.map((count) => (
            <tr key={count}>
              <td className="numeric px-3 py-2 font-bold text-foreground">{count}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {active
                    .filter((r) => r.picks_count === count && Number(r.multiplier) > 0)
                    .sort((a, b) => b.correct_count - a.correct_count)
                    .map((r) => (
                      <span key={r.id} className="numeric">
                        {r.correct_count}/{count}{" "}
                        <b className="text-primary">{formatMultiplier(Number(r.multiplier))}</b>
                      </span>
                    ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Правила и пошаговый туториал; числа — из настроек и таблицы выплат в БД. */
export function RulesView() {
  const { data: loaded } = useAppSettings();
  const { data: rules = [] } = usePayoutRules();
  const s = { ...DEFAULTS, ...loaded };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-primary/25 bg-primary/10 p-5 text-sm leading-relaxed">
        PICKUP — игра на <b>виртуальные рубли</b>. Их нельзя купить, вывести или обменять на реальные деньги. Вы прогнозируете
        статистику спортсменов в реальных матчах и соревнуетесь с другими игроками в рейтинге.
      </div>

      <Section icon={<ListChecks className="size-5" />} title="Как сделать прогноз">
        <ol className="space-y-4">
          <Step n={1} title="Выберите линию">
            На главной откройте вкладку «С линиями» или «Игроки». Линия — это спортсмен, показатель и число: например,
            «Броски в створ — 3,5».
          </Step>
          <Step n={2} title="Нажмите «Больше» или «Меньше»">
            <span className="inline-flex items-center gap-1 font-semibold text-over">
              <ArrowUp className="size-3.5" /> Больше
            </span>{" "}
            — спортсмен наберёт больше указанного числа,{" "}
            <span className="inline-flex items-center gap-1 font-semibold text-under">
              <ArrowDown className="size-3.5" /> Меньше
            </span>{" "}
            — меньше. Выбор попадает в купон.
          </Step>
          <Step n={3} title={`Соберите ${s.min_picks}–${s.max_picks} выборов`}>
            Можно смешивать спортсменов, матчи и виды спорта. Чем больше выборов, тем выше множитель.
          </Step>
          <Step n={4} title="Выберите режим: Power Play или Flex Play">
            Power Play платит больше, но только если угаданы все выборы. Flex Play прощает ошибки (от {s.flex_min_picks}{" "}
            выборов), но множители ниже.
          </Step>
          <Step n={5} title="Укажите сумму и подтвердите">
            От {formatRub(s.min_stake)} до {formatRub(s.max_stake)}, целым числом рублей. Сумма резервируется с баланса, а
            купон появляется в разделе «Мои прогнозы».
          </Step>
        </ol>
      </Section>

      <Section icon={<Coins className="size-5" />} title="Выплаты">
        <p>
          Выплата = сумма × множитель. Множитель фиксируется в момент подтверждения купона: его последующее изменение на
          ваш купон не влияет.
        </p>
        <p className="font-semibold text-foreground">Power Play — нужно угадать всё</p>
        <PowerTable rules={rules} />
        <p className="pt-2 font-semibold text-foreground">Flex Play — можно ошибиться</p>
        <FlexTable rules={rules} />
        <p className="text-xs">Если множитель меньше ×1, вы получаете часть суммы обратно. Не указанные в таблице исходы — проигрыш.</p>
      </Section>

      <Section icon={<Calculator className="size-5" />} title="Расчёт купона">
        <p>
          Купон рассчитывается после окончания всех его матчей, когда статистика спортсменов <b>подтверждена</b>. Обычно
          это занимает от нескольких минут до пары часов после финального свистка.
        </p>
        <p>Выбор аннулируется (не считается ни выигрышем, ни проигрышем), если:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>спортсмен не принял участия в матче;</li>
          <li>результат в точности равен линии;</li>
          <li>по показателю нет статистики;</li>
          <li>матч отменён.</li>
        </ul>
        <p>
          Тогда купон пересчитывается на меньшее число выборов: например, из 4 становится 3, с множителем для 3 выборов.
          Если действительных выборов осталось меньше {s.min_picks}, вся сумма возвращается на баланс.
        </p>
      </Section>

      <Section icon={<Ban className="size-5" />} title="Ограничения">
        <ul className="list-disc space-y-1 pl-5">
          <li>Один спортсмен — только один раз в купоне.</li>
          <li>Нельзя выбрать «Больше» и «Меньше» на одну и ту же линию.</li>
          <li>Приём прогнозов на матч закрывается в момент его начала.</li>
          <li>
            Если линия или множитель изменились, пока вы собирали купон, сайт попросит проверить купон и подтвердить его
            заново.
          </li>
          <li>Подтверждённый купон нельзя отменить или изменить.</li>
        </ul>
      </Section>

      <Section icon={<Gift className="size-5" />} title="Баланс и бонусы">
        <p>
          При регистрации вы получаете <b>{formatRub(s.initial_bonus_amount)}</b>.
          {s.monthly_bonus_enabled !== false ? (
            <>
              {" "}
              Каждый месяц 1-го числа в 00:00 по Москве на баланс добавляется ещё <b>{formatRub(s.monthly_bonus_amount)}</b>.
              Баланс не обнуляется — бонус прибавляется к тому, что уже есть.
            </>
          ) : null}
        </p>
      </Section>

      <Section icon={<Trophy className="size-5" />} title="Рейтинг">
        <p>
          <b>Общий рейтинг</b> — по капиталу: баланс плюс суммы в ещё не рассчитанных купонах. Прибыль в нём считается без
          учёта бонусов.
        </p>
        <p>
          <b>Месячный рейтинг</b> — по чистой прибыли от купонов, рассчитанных в текущем месяце (по Москве). Бонусы не
          учитываются, поэтому все начинают месяц на равных. Итоги прошедших месяцев сохраняются в архиве.
        </p>
      </Section>

      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
        <Button asChild size="lg" className="flex-1">
          <Link href="/">Перейти к линиям</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <Link href="/leaderboard">Открыть рейтинг</Link>
        </Button>
      </div>
    </div>
  );
}
