-- PICKUP: базовая схема — профили, настройки, кошельки, журнал операций.
-- Денежные суммы хранятся в BIGINT в копейках виртуального рубля (1 ₽ = 100).

create schema if not exists private;
revoke all on schema private from public;

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Перечисления
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('user', 'admin');

create type public.wallet_tx_type as enum (
  'INITIAL_BONUS',
  'MONTHLY_BONUS',
  'PICK_STAKE',
  'PICK_WIN',
  'PICK_REFUND',
  'ADMIN_ADJUSTMENT'
);

-- ---------------------------------------------------------------------------
-- Вспомогательные функции
-- ---------------------------------------------------------------------------

-- Первый день месяца по московскому времени для заданного момента.
create or replace function private.msk_month_start(p_ts timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', p_ts at time zone 'Europe/Moscow')::date;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Единая точка выброса бизнес-ошибок: message — текст для пользователя,
-- hint — машиночитаемый код для клиента.
create or replace function private.raise_error(p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Профили
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  avatar_url text,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_nickname_format
    check (nickname ~ '^[A-Za-zА-Яа-яЁё0-9_.-]{3,24}$')
);

create unique index profiles_nickname_lower_key on public.profiles (lower(nickname));
create index profiles_nickname_trgm_idx on public.profiles using gin (nickname gin_trgm_ops);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

create or replace function private.is_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = p_user and role = 'admin'
  );
$$;

-- Публичная обёртка для клиента и Edge Functions.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin(auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Настройки платформы (ключ → значение)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create or replace function private.setting_bigint(p_key text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (value #>> '{}')::bigint from public.app_settings where key = p_key;
$$;

create or replace function private.setting_bool(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (value #>> '{}')::boolean from public.app_settings where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- Кошельки
-- ---------------------------------------------------------------------------
create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Доступный баланс.
  balance bigint not null default 0 check (balance >= 0),
  -- Сумма, зарезервированная в активных (PENDING) прогнозах.
  reserved bigint not null default 0 check (reserved >= 0),
  -- Совокупный капитал для общего рейтинга.
  capital bigint generated always as (balance + reserved) stored,
  -- Всё, что пользователь получил не от игры: бонусы и корректировки.
  -- Прибыль за всё время = capital - funded_total.
  funded_total bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index wallets_capital_idx on public.wallets (capital desc, user_id);

-- ---------------------------------------------------------------------------
-- Журнал операций кошелька (только добавление)
-- ---------------------------------------------------------------------------
create table public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.wallets (user_id) on delete cascade,
  type public.wallet_tx_type not null,
  amount bigint not null,
  balance_after bigint not null,
  reserved_after bigint not null,
  lineup_id uuid,
  idempotency_key text not null unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wallet_transactions_amount_sign check (
    case type
      when 'PICK_STAKE' then amount < 0
      when 'ADMIN_ADJUSTMENT' then amount <> 0
      else amount > 0
    end
  )
);

create index wallet_transactions_user_created_idx
  on public.wallet_transactions (user_id, created_at desc, id desc);
create index wallet_transactions_type_created_idx
  on public.wallet_transactions (type, created_at desc);
create index wallet_transactions_lineup_idx
  on public.wallet_transactions (lineup_id) where lineup_id is not null;

-- ---------------------------------------------------------------------------
-- Ежемесячные начисления: одна запись на пользователя и календарный месяц (МСК)
-- ---------------------------------------------------------------------------
create table public.monthly_bonus_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  year smallint not null check (year between 2020 and 2200),
  month smallint not null check (month between 1 and 12),
  -- REGISTRATION: месяц регистрации закрыт стартовым бонусом (исключает двойное начисление).
  kind text not null check (kind in ('REGISTRATION', 'MONTHLY')),
  amount bigint not null check (amount >= 0),
  transaction_id bigint references public.wallet_transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint monthly_bonus_grants_user_period_key unique (user_id, year, month)
);

create index monthly_bonus_grants_period_idx on public.monthly_bonus_grants (year, month);

-- ---------------------------------------------------------------------------
-- Агрегаты для рейтингов (обновляются только при расчёте прогнозов)
-- ---------------------------------------------------------------------------
create table public.user_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  lineups_total integer not null default 0 check (lineups_total >= 0),
  lineups_settled integer not null default 0 check (lineups_settled >= 0),
  lineups_won integer not null default 0 check (lineups_won >= 0),
  total_staked bigint not null default 0 check (total_staked >= 0),
  total_payout bigint not null default 0 check (total_payout >= 0),
  updated_at timestamptz not null default now()
);

create table public.monthly_user_stats (
  user_id uuid not null references public.profiles (id) on delete cascade,
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  lineups_settled integer not null default 0,
  lineups_won integer not null default 0,
  staked bigint not null default 0,
  payout bigint not null default 0,
  -- Чистая прибыль от рассчитанных прогнозов; бонусы сюда не входят.
  profit bigint generated always as (payout - staked) stored,
  updated_at timestamptz not null default now(),
  primary key (user_id, year, month)
);

create index monthly_user_stats_rank_idx
  on public.monthly_user_stats (year, month, profit desc, user_id);

-- Архив месячных рейтингов: фиксируется после окончания месяца.
create table public.leaderboard_snapshots (
  id bigint generated always as identity primary key,
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  rank integer not null check (rank > 0),
  user_id uuid not null references public.profiles (id) on delete cascade,
  nickname text not null,
  avatar_url text,
  profit bigint not null,
  lineups_settled integer not null,
  lineups_won integer not null,
  created_at timestamptz not null default now(),
  constraint leaderboard_snapshots_period_user_key unique (year, month, user_id)
);

create index leaderboard_snapshots_rank_idx on public.leaderboard_snapshots (year, month, rank);

-- ---------------------------------------------------------------------------
-- Аудит действий администраторов
-- ---------------------------------------------------------------------------
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

create or replace function private.audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_payload, '{}'::jsonb));
$$;
