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
6. [Спортивные данные: OddsPapi, источники результатов, ограничения](#спортивные-данные)
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
    _shared/sports-providers/   слой провайдеров (OddsPapi, NHL, OpenDota, API-Football), конвейер синхронизации
    sports-sync/                Edge Function: расписание, линии, результаты
  seed.sql             тестовые аккаунты для локальной разработки
tests/db/              интеграционные тесты на настоящем PostgreSQL 17
```

**Поток данных**

```
OddsPapi / NHL / OpenDota ──► Edge Function sports-sync ──► RPC ingest_schedule / ingest_slate / ingest_match_stats
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

Edge Function (нужен ключ OddsPapi — на сайте показываются только реальные события):

```bash
cat > supabase/.env.functions <<'EOF'
SPORTS_PROVIDERS=oddspapi
ODDSPAPI_API_KEY=ваш_ключ
CRON_SECRET=local-dev-secret
EOF
supabase functions serve sports-sync --env-file supabase/.env.functions
```

```bash
npm run dev                          # http://localhost:3000
```

Войдите как `admin@pickup.local` / `pickup-demo-2026` (тестовые аккаунты есть только в локальном `seed.sql`), откройте **Админ-панель → Спортивные API → Полная синхронизация**: загрузятся реальное расписание и линии из OddsPapi.

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
   supabase secrets set SPORTS_PROVIDERS=oddspapi ODDSPAPI_API_KEY=<ключ> RESULTS_PROVIDERS=nhl,opendota CRON_SECRET=$(openssl rand -hex 32)
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
| `pickup-team-logos` | `*/10 * * * *` | `sports-sync` с `{"action":"logos"}` — поиск логотипов команд |
| `pickup-player-photos` | `5-59/10 * * * *` | `sports-sync` с `{"action":"photos"}` — поиск фото спортсменов |

Проверка: `select * from cron.job;` и `select * from cron.job_run_details order by start_time desc limit 20;`.

## Спортивные данные

Слой провайдеров находится в `supabase/functions/_shared/sports-providers/` и реализует интерфейс `SportsDataProvider`:
`getSports`, `getLeagues`, `getMatches`, `getPlayers`, `getPlayerProps`, `getPlayerStats`. Получение линий (`syncLines`) и результатов (`syncResults`) разделено. Запись в БД идёт пакетно через RPC `ingest_slate` и `ingest_results`, без N+1.

### Только реальные данные

На сайте нет вымышленных матчей: тестовый провайдер удалён из кода, все события, команды, даты и результаты приходят из внешних API. Если источник не вернул матчей, список пустой.

### Расписание: все турниры

Раз в `SCHEDULE_INTERVAL_HOURS` (12 ч) функция `sports-sync` запрашивает `GET /v4/fixtures?sportId&from&to&language=ru` для каждого вида спорта с `sports.schedule_enabled = true` — **один запрос на вид спорта** отдаёт матчи всех турниров за окно −6 ч…+72 ч (сегодня и два следующих дня) (футбол — около 1700 матчей из 400 турниров в сутки). Турниры создаются автоматически (`leagues.code = OP_<tournamentId>`), названия команд и турниров — на русском. Виртуальные турниры («Simulated Reality League» и т. п.) отфильтровываются.

Включены: футбол, хоккей, баскетбол, теннис, волейбол, гандбол, Dota 2, CS2. Ещё 12 видов спорта (бейсбол, американский футбол, ММА, бокс, настольный теннис, регби, крикет, футзал, дартс, снукер, LoL, Valorant) заведены в справочнике и включаются флагом `sports.schedule_enabled` — каждый добавляет 1 запрос за запуск.

На главной: вкладка **«С линиями»** — матчи, на которые можно собрать купон; **«Все события»** — полное расписание по турнирам (Сейчас / Сегодня / Завтра, поиск).

### OddsPapi

Интеграция написана строго по [документации OddsPapi v4](https://oddspapi.io/en/docs):
`GET /v4/sports`, `/tournaments?sportId`, `/fixtures?tournamentId&from&to`, `/markets`, `/odds?fixtureId&bookmakers`. Ключ передаётся параметром `apiKey`, паузы между запросами соответствуют cooldown из документации, ответы кэшируются в таблице `provider_cache`.

Подключение:

1. Получите ключ на [oddspapi.io](https://oddspapi.io).
2. ```bash
   supabase secrets set SPORTS_PROVIDERS=oddspapi ODDSPAPI_API_KEY=<ключ>
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
- Покрытие на октябрь 2026: **НХЛ, НБА, АПЛ** — хорошее; **ЛЧ** — почти только голы; **КХЛ и РПЛ — player props нет**: такие матчи показываются в расписании без линий (линии можно выставить вручную в админке).
- Турниры: НХЛ 234, НБА 132, АПЛ 17, ЛЧ 7, КХЛ 268, РПЛ 203. Сейчас подключены НХЛ и АПЛ, для них есть автоматические результаты.
- **Бесплатный план — 250 запросов** (`request_limit` в `GET /v4/account`, период не указан). Поэтому Cron обновляет линии OddsPapi не чаще раза в `ODDSPAPI_MIN_INTERVAL_HOURS` (12 ч). Запуск расходует не больше `ODDSPAPI_MAX_REQUESTS` (10) запросов и берёт `ODDSPAPI_MAX_FIXTURES` (4) ближайших матча. Ручной запуск из админки работает всегда. Для полноценной работы нужен платный план.
- Статистики спортсменов в OddsPapi нет: результаты берутся у провайдеров статистики (ниже).

### Киберспорт: Dota 2 и Counter-Strike 2

- **Линии** берутся из OddsPapi: «Убийства за матч» (Dota 2, CS2) и «Хедшоты за матч» (CS2), полный матч — `period=result`. Турниры в киберспорте постоянно меняются, поэтому лига («DOTA2», «CS2») охватывает весь вид спорта OddsPapi (`external_ids.oddspapi_sport`: 16 и 17).
- Букмекеры выставляют линии на игроков только на **крупные турниры** — проверено: у матчей низших дивизионов CS2 их нет ни у одного из 56 букмекеров. Поэтому берутся только турниры первого эшелона (`TIER1_ESPORTS`: IEM, BLAST, ESL Pro League, PGL, мейджоры, The International, DreamLeague…). Список можно переопределить в `leagues.external_ids.oddspapi_tournaments` (регулярное выражение).
- **Результаты Dota 2** — автоматически из [OpenDota](https://www.opendota.com/) (бесплатно, без ключа): серия собирается по `series_id`, убийства суммируются по картам, серия считается завершённой по счёту карт (BO1/BO2/BO3/BO5). У игроков без профессионального ника в OpenDota сопоставление не сработает — такой матч уйдёт админу на проверку.
- **Результаты CS2** вводятся в админке: бесплатного проверенного источника статистики нет, HLTV блокирует автоматические запросы.
- Чтобы при малом бюджете киберспорт не вытеснял остальные лиги, коэффициенты запрашиваются по очереди из каждой лиги (`roundRobinByLeague`).

### Провайдеры статистики (результаты)

Линии матча и статистика могут приходить из разных источников. Для матчей с линиями Edge Function ищет игру у провайдера статистики по дате и командам и забирает статистику спортсменов. Затем она сопоставляет спортсменов по имени: полное имя → инициал + фамилия → уникальная фамилия, с учётом формата «Фамилия, Имя» и диакритики. Результат сохраняется через RPC `ingest_match_stats`, связь с игрой провайдера — в `match_result_links`.

**Матч подтверждается автоматически, только если сопоставлены все спортсмены с линиями.** Иначе статистика сохраняется без подтверждения, несопоставленные имена видны в админке («События и линии» → матч), и администратор завершает расчёт вручную. Ручной ввод не перезаписывается при следующих синхронизациях.

| Провайдер | Лиги | Ключ | Статус |
|---|---|---|---|
| `balldontlie` — BALLDONTLIE NHL (`api.balldontlie.io/nhl/v1`) и NBA (`/v1`) | НХЛ, НБА | `BALLDONTLIE_API_KEY`, тариф ALL-STAR ($9.99/мес.): матчи, box scores, составы | **основной для НХЛ и НБА**: лицензированные данные, коммерческое использование разрешено. Play-by-play на ALL-STAR недоступен — live НХЛ остаётся на NHL API |
| `nhl` — публичный API НХЛ (`api-web.nhle.com`) | НХЛ | не нужен | резервный; условия NHL.com разрешают только некоммерческое использование — для расчёта отключён (`RESULTS_PROVIDERS=balldontlie,opendota,apifootball`) |
| `apifootball` — API-Football | АПЛ, Бундеслига, Ла Лига, Серия А, Лига 1, РПЛ (`leagues.external_ids.apifootball`) | тариф **Pro, $19/мес.**: 7 500 запросов в сутки, 300 в минуту, текущий сезон | работает: результаты и статистика игроков, live (обновление раз в минуту), линии PICKUP |
| `opendota` — OpenDota | Dota 2 | не нужен | включён; проверен на реальной серии |
| — | КХЛ, CS2 | — | ручной ввод в админке |

Подключение API-Football:

```bash
APIFOOTBALL_API_KEY=ваш_ключ node scripts/apifootball-probe.mjs   # ID лиг, сезон, реальные поля
# ID шести лиг главной уже записаны миграцией 20261018000500_apifootball_leagues.sql, затем:
supabase secrets set APIFOOTBALL_API_KEY=ваш_ключ RESULTS_PROVIDERS=balldontlie,opendota,apifootball \
  HOUSE_LINES=EPL,OP_35,OP_8,OP_23,OP_34,RPL
supabase functions deploy sports-sync --use-api && supabase functions deploy live-match --use-api
```

Аналогичная проверка OddsPapi: `ODDSPAPI_API_KEY=ваш_ключ node scripts/oddspapi-probe.mjs`.

SportsGameOdds как альтернатива подключается тем же интерфейсом `SportsDataProvider`; на этом этапе он не реализован.

### Покрытие и ограничения (октябрь 2026)

| Что | Источник | Ограничение |
|---|---|---|
| Расписание 8 видов спорта, все турниры | OddsPapi | бесплатный план — **250 запросов всего**; расписание тратит ~8 запросов за запуск. Для продакшена нужен платный план |
| Линии на игроков | OddsPapi | только там, где их дают букмекеры: НХЛ, НБА, АПЛ, топ-турниры Dota 2/CS2 (`leagues.props_enabled`) |
| Результаты и статистика НХЛ | BALLDONTLIE NHL ALL-STAR | $9.99/мес., автоматически; live — NHL API |
| Линии PICKUP на все матчи НХЛ | BALLDONTLIE NHL ALL-STAR (box scores сезона) | `{"action":"nhl_lines"}`, Cron `pickup-nhl-lines` раз в 3 часа; до `NHL_LINES_PER_TEAM` (20) игроков на команду: броски в створ, очки, голы, передачи, сейвы. Матчи с линиями букмекеров (OddsPapi) не дублируются; игрок, не выходивший в последних 3 матчах команды, линий не получает |
| Результаты, статистика и линии PICKUP на все матчи НБА | BALLDONTLIE NBA ALL-STAR ($9.99/мес., тот же ключ) | расчёт — `/v1/games/{id}`, `/v1/stats?game_ids[]`; линии — `{"action":"nba_lines"}`, Cron `pickup-nba-lines` раз в 3 часа, до `NBA_LINES_PER_TEAM` (15) игроков текущего состава: очки, подборы, передачи, трёхочковые и их суммы. Новички без матчей за команду — по средним прошлого сезона (`/v1/season_averages`) |
| Английские названия команд | OddsPapi `/v4/participants?language=en` | раз в 3 дня на вид спорта, только если у команд нет `name_en` (нужно для сопоставления с BALLDONTLIE, API-Football и поиска логотипов) |
| Результаты Dota 2 | OpenDota | бесплатно, автоматически |
| Футбол: 6 лиг главной (результаты, статистика, live, линии PICKUP) | API-Football Pro | `RESULTS_PROVIDERS=balldontlie,opendota,apifootball`, `HOUSE_LINES=EPL,OP_35,OP_8,OP_23,OP_34,RPL`. Линии PICKUP прикрепляются к матчам расписания OddsPapi (сопоставление по времени и командам), отдельные матчи не создаются |
| НБА, КХЛ, CS2 | — | результаты вводятся в админке |
| Теннис, волейбол, гандбол и др. | OddsPapi | только расписание: нет статистики игроков, линии не выставляются |
| Фото спортсменов | NHL API, NBA CDN, Sportmonks, Wikimedia Commons | см. «Фото спортсменов» ниже |
| Логотипы команд | NHL API, OpenDota, TheSportsDB | OddsPapi логотипов не даёт. Поиск по английскому названию (`teams.name_en`), партиями по `LOGOS_BATCH` (12) команд раз в 10 минут: сначала команды с линиями, затем известные лиги, затем ближайшие матчи. Логотип сохраняется только при совпадении вида спорта и названия, иначе остаётся аббревиатура; повторная проверка — через 30 дней. Бесплатный ключ TheSportsDB (`123`) — до 30 запросов в минуту, свой ключ задаётся в `THESPORTSDB_API_KEY` |

### Фото спортсменов

OddsPapi отдаёт только имя спортсмена — без фото и ID лиг. Функция `sports-sync` (`{"action":"photos"}`, Cron раз в 10 минут, `PHOTOS_BATCH` = 10 спортсменов) ищет фото по порядку источников и сохраняет `photo_url`, `photo_source`, `photo_license`, `photo_author`, `photo_license_url`, `photo_page_url`, `external_player_id` в `players`. При отображении ничего не ищется.

| Спорт | Источник | Как подтверждается личность |
|---|---|---|
| НХЛ | NHL API: `headshot` из `/v1/roster/{TEAM}/current` или `/v1/player/{id}/landing` | имя совпадает ровно с одним игроком в ростерах команд матча; иначе NHL ID из Wikidata (P3522) |
| НБА | `cdn.nba.com/headshots/nba/latest/1040x760/{personId}.png` | personId только из Wikidata (P3647 «NBA.com player ID»); силуэт CDN для неизвестного ID отсекается по хэшу |
| Футбол | API-Football `/players/profiles?player={id}` → `media.api-sports.io/football/players/{id}.png` | по ID игрока (тот же источник, что и линии PICKUP) — без поиска по имени; полные имена профиля используются и для поиска на Wikimedia |
| Футбол (запасной) | Sportmonks Football API (`image_path`) | имя и команда матча; **только при `SPORTMONKS_API_KEY`** — без ключа источник пропускается |
| Остальные, КХЛ, киберспорт | Wikidata (P18) → Wikimedia Commons | человек (P31=Q5), вид спорта (P641), имя (en/ru); при однофамильцах — команда (P54) |

- Адрес `assets.nhle.com/mugs/nhl/latest/520x520/{id}.png` не используется: для части игроков он перенаправляет на заглушку `default-skater.png`. Справочники НБА (`stats.nba.com`, `cdn.nba.com/static/json`) закрыты (HTTP 403).
- С Commons берутся только CC0, PD, CC BY и CC BY-SA. Автор и лицензия показываются при наведении на фото, значок © ведёт на страницу файла.
- Перед сохранением картинка скачивается: нужны HTTP 200, `image/*` и не заглушка источника. Найденное фото по расписанию не перепроверяется: заново оно ищется только при смене команды игрока (триггер `players_recheck_photo`). Если фото не нашлось — повторная попытка раз в 30 дней.
- Для КХЛ и киберспорта открытых официальных API с фото нет (khl.ru, HLTV и Liquipedia не дают публичного API с разрешением на использование изображений) — только Commons, иначе силуэт.
- `WIKIMEDIA_CONTACT` — контакт владельца сайта (адрес сайта или почта) для User-Agent: без него Wikimedia строже ограничивает частоту запросов.

Что можно подключить для расширения: платный OddsPapi (линии и больше запросов), API-Sports на платном тарифе (футбол, баскетбол, хоккей, волейбол, гандбол — статистика и результаты), SportsGameOdds (player props, интерфейс провайдера готов), PandaScore или GRID (статистика CS2/LoL/Valorant).

## Live-трансляция матчей

Когда матч начался, страница матча показывает онлайн-центр: табло, схему площадки или поля и ленту событий. На главной появляется блок «Сейчас идут» со счётом.

| Источник | Что показывается | Обновление |
|---|---|---|
| НХЛ (`api-web.nhle.com` play-by-play) | счёт, период, время, броски в створ; **карта бросков и голов по координатам**, удаления | ~15 с |
| API-Football (`/fixtures?id`) | счёт, минута, таймлайн и лента: голы, карточки, замены. Координат источник не даёт — поле не рисуется | 1 мин (тариф Pro) |

Данные отдаёт Edge Function `live-match` (публичная, только чтение). Ответы кэшируются в `provider_cache`, поэтому сколько бы зрителей ни смотрело матч, к источнику уходит не больше одного запроса за время кэша. Координаты нормализуются так, что хозяева всегда атакуют вправо: в НХЛ команды меняются сторонами каждый период. Live-данные служат только для отображения, расчёт купонов идёт по подтверждённой статистике.

Деплой: `supabase functions deploy live-match --use-api`.

## Видеотрансляции

На странице матча может быть встроенный плеер официальной бесплатной трансляции: YouTube, Twitch, VK Видео или Rutube. Ссылку вносит администратор в карточке матча (Админка → Матчи → «Трансляция»). RPC `admin_set_match_stream` пропускает только эти площадки, `src/lib/stream-embed.ts` превращает ссылку в адрес плеера. Видео не хранится и не проксируется — воспроизведение идёт с площадки правообладателя, плеер загружается по нажатию.

Пиратские и неофициальные потоки не поддерживаются. Трансляции НХЛ, КХЛ и топ-лиг футбола распространяются по лицензии (ESPN+, KHL Prime, Okko, «Матч ТВ») и встраиваются только по договору с правообладателем или лицензированным видеопровайдером.

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
