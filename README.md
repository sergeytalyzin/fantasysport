# PICKUP

Бесплатная платформа спортивных прогнозов «Больше/Меньше» на статистику спортсменов с **виртуальными рублями**.
Пользователь собирает купон из 2–6 прогнозов (Power Play или Flex Play), получает виртуальную выплату и соревнуется в рейтинге.

> В проекте нет реальных денег: депозитов, выводов и конвертации виртуальных рублей не существует.

- **Frontend:** Next.js 16 (App Router, Turbopack, Cache Components), React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui (собственная тема), TanStack Query, Zustand, React Hook Form + Zod, Lucide.
- **Backend:** Supabase — PostgreSQL (RPC + RLS), Auth, Storage, Edge Functions, Cron, Realtime.
- **Хостинг:** Vercel (frontend) + Supabase Cloud.

---

## Содержание

1. [Архитектура](#архитектура)
2. [Ключевые правила и решения](#ключевые-правила-и-решения)
3. [Локальный запуск](#локальный-запуск)
4. [Подключение Supabase Cloud](#подключение-supabase-cloud)
5. [Supabase Cron](#supabase-cron)
6. [Спортивные данные: Demo Provider и OddsPapi](#спортивные-данные)
7. [Деплой на Vercel](#деплой-на-vercel)
8. [Тесты](#тесты)
9. [Безопасность](#безопасность)

---

## Архитектура

```
src/
  app/
    (auth)/            login, register, forgot-password, reset-password
    (main)/            / (линии), lineups, leaderboard, wallet, profile
    admin/             защищённая админ-панель (9 разделов)
    auth/              callback и confirm (подтверждение email, сброс пароля)
    manifest.ts, pwa-icons/, apple-icon.tsx, icon.svg   PWA
  components/
    ui/                shadcn/ui, переоформленные под дизайн-систему
    layout/ picks/ sports/ lineups/ leaderboard/ wallet/ profile/ admin/ auth/
  features/            запросы к данным и хуки TanStack Query по доменам
    auth/ sports/ projections/ picks/ wallet/ leaderboard/ profile/ admin/
  lib/                 supabase-клиенты, форматирование, ошибки, валидация (zod)
  stores/              Zustand: купон (persist в localStorage)
  proxy.ts             обновление сессии и защита маршрутов (бывший middleware)
supabase/
  migrations/          схема, функции, RLS, Storage, Realtime, Cron, справочники
  functions/
    _shared/sports-providers/   слой провайдеров (Demo, OddsPapi), конвейер синхронизации
    sports-sync/                Edge Function: синхронизация, симуляция демо-матчей
  seed.sql             тестовые аккаунты для локальной разработки
tests/db/              интеграционные тесты на настоящем PostgreSQL 17
```

**Поток данных**

```
Провайдер (Demo / OddsPapi) ──► Edge Function sports-sync ──► RPC ingest_slate / ingest_results
                                    ▲ (Cron каждые 15 мин,                │
                                    │  кнопки в админке)                  ▼
Браузер ──► Supabase (RLS: только чтение) ◄── PostgreSQL: create_lineup, settle_match, бонусы, рейтинги
       └──► RPC create_lineup (проверки, списание, снимок условий) ── Realtime: свой кошелёк и купоны
```

Бизнес-логика живёт **только в PostgreSQL**: подтверждение купона, расчёт, бонусы и рейтинги. Клиент показывает множители из таблицы `payout_rules` и ничего не рассчитывает окончательно.

## Ключевые правила и решения

| Тема | Решение |
|---|---|
| Деньги | `BIGINT` в копейках. 100 000 ₽ = `10000000`. |
| Изменение баланса | Только `private.wallet_apply`: сначала `SELECT … FOR UPDATE` кошелька, затем проверка ключа идемпотентности. Каждая операция пишется в `wallet_transactions` с уникальным `idempotency_key`. |
| Стартовый бонус | Триггер на `auth.users` создаёт профиль, кошелёк и начисляет 100 000 ₽ (ключ `initial_bonus:<uid>`). Месяц регистрации отмечается в `monthly_bonus_grants` → без двойного начисления 1-го числа. |
| Ежемесячный бонус | +100 000 ₽ **к существующему балансу**, без сбросов. Уникальность `(user_id, year, month)`. Функция начисляет все пропущенные месяцы — восстановление после простоя. |
| Купон | `create_lineup` проверяет: число выборов, дубли и противоположные исходы, одного спортсмена — один раз, открытость линии, не начавшийся матч, совпадение линии, множитель, сумму и баланс. Сохраняет снимок линий и таблицы выплат. |
| Расчёт | Только для отменённого матча или завершённого матча с **подтверждённой** статистикой. Неучастие спортсмена, отсутствие показателя или равенство линии аннулируют выбор: купон понижается (например, 3 → 2 выбора). Если действительных выборов меньше 2 — полный возврат. Повторный расчёт безопасен. |
| Power Play | ×3 / ×5 / ×10 / ×20 / ×37,5 для 2–6 выборов. |
| Flex Play | От 3 выборов, частичные выплаты (например, 5 выборов: 5/5 ×10, 4/5 ×2, 3/5 ×0,4). Все множители в БД и редактируются в админке. |
| Общий рейтинг | Капитал = баланс + резерв в активных купонах. Прибыль = капитал − (бонусы + корректировки). |
| Месячный рейтинг | Чистая прибыль рассчитанных купонов за месяц (МСК), бонусы не учитываются. Прошедшие месяцы фиксируются в `leaderboard_snapshots`. |
| Время | Месяц везде определяется по `Europe/Moscow`. |

## Локальный запуск

Нужны Node.js ≥ 20.9, Docker и [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
npm install
supabase start                      # локальный Supabase в Docker
supabase db reset                   # миграции + seed.sql (тестовые аккаунты)
cp .env.example .env.local          # вставьте URL и publishable/anon key из `supabase status`
```

Edge Function с Demo Provider:

```bash
cat > supabase/.env.functions <<'EOF'
SPORTS_PROVIDERS=demo
CRON_SECRET=local-dev-secret
EOF
supabase functions serve sports-sync --env-file supabase/.env.functions
```

```bash
npm run dev                          # http://localhost:3000
```

Войдите как `admin@pickup.local` / `pickup-demo-2026`, откройте **Админ-панель → Спортивные API → Полная синхронизация**: появятся демо-матчи и линии. В разделе **События и линии** любой демо-матч можно завершить кнопкой «Симулировать завершение» — прогнозы рассчитаются сразу.

## Подключение Supabase Cloud

1. Создайте проект на [supabase.com](https://supabase.com), регион — ближайший к аудитории (например, Frankfurt).
2. Свяжите репозиторий и примените миграции:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push                 # seed.sql в облако НЕ применяется
   ```
   Справочники (виды спорта, лиги, рынки, множители, настройки) входят в миграции.
3. **Auth → URL Configuration**:
   - Site URL: `https://<ваш-домен>`
   - Redirect URLs: `https://<ваш-домен>/auth/callback`, `https://<ваш-домен>/auth/confirm`, а также `http://localhost:3000/**` для разработки.
4. **Секреты и деплой Edge Function**:
   ```bash
   supabase secrets set SPORTS_PROVIDERS=demo CRON_SECRET=$(openssl rand -hex 32)
   supabase functions deploy sports-sync
   ```
   `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase передаёт функции сам. **service_role key не нужен и не должен попадать во frontend/Vercel.**
5. **Секреты для Cron в Vault** (SQL Editor), значения — те же, что выше:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'pickup_functions_url');
   select vault.create_secret('<тот же CRON_SECRET>', 'pickup_cron_secret');
   ```
   Если расширения `pg_cron`/`pg_net` не были включены на момент `db push`, включите их (Database → Extensions) и выполните заново блоки `do $cron$` и `do $sync$` из `supabase/migrations/20261017001000_platform.sql`.
6. **Назначьте администратора** после регистрации своего аккаунта:
   ```sql
   update public.profiles set role = 'admin'
    where id = (select id from auth.users where email = 'you@example.com');
   ```
7. Запустите первую синхронизацию из админки (Спортивные API → Полная синхронизация).

Типы БД для TypeScript можно сгенерировать командой `npm run db:types` (нужен `supabase link`).

## Supabase Cron

pg_cron работает в **UTC**. В Москве нет перехода на летнее время, смещение всегда +3, поэтому 00:00 МСК 1-го числа = 21:00 UTC последнего дня предыдущего месяца. pg_cron не умеет задавать «последний день месяца», поэтому задача запускается 28–31 числа в 21:00 UTC, а функция идемпотентна и начисляет бонус, только когда в Москве наступил новый месяц.

| Задача | Расписание (UTC) | Что делает |
|---|---|---|
| `pickup-monthly-bonus` | `0 21 28-31 * *` | Ежемесячный бонус ровно в 00:00 МСК 1-го числа |
| `pickup-hourly-maintenance` | `7 * * * *` | Догоняющее начисление пропущенных бонусов, архив месячного рейтинга, расчёт готовых матчей |
| `pickup-settlement` | `*/5 * * * *` | Расчёт матчей с подтверждённой статистикой |
| `pickup-sports-sync` | `*/15 * * * *` | Вызов Edge Function `sports-sync` через `pg_net` (линии + результаты) |

Проверка: `select * from cron.job;` и `select * from cron.job_run_details order by start_time desc limit 20;`.

## Спортивные данные

Слой провайдеров находится в `supabase/functions/_shared/sports-providers/` и реализует интерфейс `SportsDataProvider`:
`getSports`, `getLeagues`, `getMatches`, `getPlayers`, `getPlayerProps`, `getPlayerStats`. Получение линий (`syncLines`) и результатов (`syncResults`) разделено. Запись в БД идёт пакетно через RPC `ingest_slate` и `ingest_results`, без N+1.

### Demo Provider (по умолчанию)

- Детерминированные **тестовые** матчи всех шести лиг (КХЛ, НХЛ, РПЛ, АПЛ, ЛЧ, НБА) на 3 дня вперёд, линии и статистика. Одинаковые входные данные всегда дают одинаковый результат, поэтому расчёт воспроизводим.
- Составы КХЛ и РПЛ вымышлены. В остальных лигах используются известные спортсмены, но клубы и показатели условны.
- Все демо-данные помечены в интерфейсе бейджем **«Демо»**.
- Результаты появляются автоматически после окончания матча по расписанию. Кнопка **«Симулировать завершение»** в админке завершает матч сразу.

### OddsPapi

Интеграция написана строго по [документации OddsPapi v4](https://oddspapi.io/en/docs):
`GET /v4/sports`, `/tournaments?sportId`, `/fixtures?tournamentId&from&to`, `/markets`, `/odds?fixtureId&bookmakers`. Ключ передаётся параметром `apiKey`, паузы между запросами соответствуют cooldown из документации, ответы кэшируются в таблице `provider_cache`.

Подключение:

1. Получите ключ на [oddspapi.io](https://oddspapi.io).
2. ```bash
   supabase secrets set SPORTS_PROVIDERS=demo,oddspapi ODDSPAPI_API_KEY=<ключ> ODDSPAPI_BOOKMAKERS=pinnacle
   supabase functions deploy sports-sync
   ```
3. Узнайте `tournamentId` нужных лиг (`GET https://api.oddspapi.io/v4/tournaments?sportId=<id>&apiKey=…`) и сохраните их:
   ```sql
   update public.leagues set external_ids = external_ids || '{"oddspapi": "<tournamentId>"}' where code = 'NBA';
   ```
4. Админка → Спортивные API → «Только линии».

**Что проверено на реальных данных** (`scripts/oddspapi-probe.mjs`):

- `participant1` — хозяева (сверено с расписанием НХЛ).
- Player props «больше/меньше» — рынки `marketType = playertotals-*` с исходами Over/Under. Полный матч — `period` `result` или `fulltime+overtime`; четверти и периоды игнорируются. Соответствие кодам рынков — `MARKET_TYPE_MAP`.
- Флаг `mainLine` букмекеры не выставляют. Основная линия выбирается по консенсусу букмекеров: та, где цены Over и Under ближе всего.
- Без фильтра `bookmakers` ответ `/odds` весит десятки мегабайт. По умолчанию используются 10 букмекеров с хорошим покрытием (`DEFAULT_BOOKMAKERS`), их можно переопределить через `ODDSPAPI_BOOKMAKERS`.
- Покрытие на октябрь 2026: **НХЛ, НБА, АПЛ** — хорошее; **ЛЧ** — почти только голы; **КХЛ и РПЛ — player props нет**, для них остаются демо-линии и ручные линии в админке.
- Турниры: НХЛ 234, НБА 132, АПЛ 17, ЛЧ 7, КХЛ 268, РПЛ 203. Сейчас подключены НХЛ и АПЛ, для них есть автоматические результаты.
- **Бесплатный план — 250 запросов** (`request_limit` в `GET /v4/account`, период не указан). Поэтому Cron обновляет линии OddsPapi не чаще раза в `ODDSPAPI_MIN_INTERVAL_HOURS` (12 ч). Запуск расходует не больше `ODDSPAPI_MAX_REQUESTS` (10) запросов и берёт `ODDSPAPI_MAX_FIXTURES` (4) ближайших матча. Ручной запуск из админки работает всегда. Для полноценной работы нужен платный план.
- Статистики спортсменов в OddsPapi нет: результаты берутся у провайдеров статистики (ниже).

### Провайдеры статистики (результаты)

Линии матча и статистика могут приходить из разных источников. Для матчей, которые не относятся к демо-данным (например, от OddsPapi), Edge Function ищет игру у провайдера статистики по дате и командам и забирает статистику спортсменов. Затем она сопоставляет спортсменов по имени: полное имя → инициал + фамилия → уникальная фамилия, с учётом формата «Фамилия, Имя» и диакритики. Результат сохраняется через RPC `ingest_match_stats`, связь с игрой провайдера — в `match_result_links`.

**Матч подтверждается автоматически, только если сопоставлены все спортсмены с линиями.** Иначе статистика сохраняется без подтверждения, несопоставленные имена видны в админке («События и линии» → матч), и администратор завершает расчёт вручную. Ручной ввод не перезаписывается при следующих синхронизациях.

| Провайдер | Лиги | Ключ | Статус |
|---|---|---|---|
| `nhl` — публичный API НХЛ (`api-web.nhle.com`) | НХЛ | не нужен | включён по умолчанию; проверен на живых играх |
| `apifootball` — API-Football | РПЛ, АПЛ, ЛЧ | бесплатный, 100 запросов в сутки | включён; проверен на живых матчах. Бесплатный тариф отдаёт матчи только в окне «вчера–завтра» — результаты нужно забирать в течение суток |
| — | НБА, КХЛ | — | ручной ввод в админке |

Подключение API-Football:

```bash
APIFOOTBALL_API_KEY=ваш_ключ node scripts/apifootball-probe.mjs   # ID лиг, сезон, реальные поля
# выполните выведенный SQL (external_ids.apifootball), затем:
supabase secrets set RESULTS_PROVIDERS=nhl,apifootball APIFOOTBALL_API_KEY=ваш_ключ
supabase functions deploy sports-sync --use-api
```

Аналогичная проверка OddsPapi: `ODDSPAPI_API_KEY=ваш_ключ node scripts/oddspapi-probe.mjs`.

SportsGameOdds как альтернатива подключается тем же интерфейсом `SportsDataProvider`; на этом этапе он не реализован.

## Деплой на Vercel

1. Импортируйте репозиторий в Vercel (Framework: Next.js, настройки по умолчанию).
2. Environment Variables (Production и Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable или legacy anon key)
3. Добавьте домен Vercel в Redirect URLs Supabase Auth (см. выше).
4. Deploy. Проверка: `/manifest.webmanifest`, регистрация, начисление 100 000 ₽, купон.

## Тесты

```bash
npm test              # все тесты
npm run test:unit     # форматирование, логика купона, провайдеры (моки fetch по схеме документации)
npm run test:db       # интеграционные тесты на настоящем PostgreSQL 17 (embedded-postgres)
npm run check         # typecheck + lint + тесты + production-сборка
```

Интеграционные тесты не требуют Docker: пакет `embedded-postgres` запускает PostgreSQL 17, к нему применяются все миграции поверх эмуляции окружения Supabase (роли `anon`/`authenticated`/`service_role`, `auth.uid()`). Покрыто:
регистрация и стартовый бонус, ежемесячный бонус (граница МСК, регистрация 1-го числа, восстановление после простоя, повторный запуск), списание и недостаточный баланс, Power Play и Flex Play, выигрыш, проигрыш, частичный выигрыш, возврат, отмена матча, неучастие спортсмена, равенство линии, отсутствие статистики, неподтверждённая статистика, повторный settlement и повторный приём результатов, **конкурентные операции** (параллельные купоны, одинаковые ключи, бонусы и расчёт), общий и месячный рейтинги с архивом, RLS (чужой кошелёк, прямые INSERT/UPDATE/DELETE, роли), административные функции, сквозной сценарий «Demo Provider → БД → купон → симуляция → расчёт».

## Безопасность

- Клиент только читает данные, разрешённые RLS. `INSERT/UPDATE/DELETE` отозваны у `anon` и `authenticated` на всех таблицах; исключение — никнейм и аватар своего профиля (column-level grant).
- `EXECUTE` на функции выдаётся точечно. Внутренние функции живут в схеме `private`, которую API не публикует.
- Права администратора проверяются в каждой `admin_*` RPC (`private.require_admin()`) и в RLS. `proxy.ts` выполняет только оптимистичную проверку. Все изменения администраторов пишутся в `admin_audit_logs`.
- Ключи внешних API хранятся только в Supabase Secrets, внешние API вызываются только из Edge Function.
- Аватары: Storage-политика разрешает запись только в папку `avatars/<свой uid>/`.
- Realtime: подписка только на свой кошелёк и свои купоны. Рейтинг обновляется запросом раз в минуту и не транслируется всем.
