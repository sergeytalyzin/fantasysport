-- PICKUP: спортивные данные — виды спорта, лиги, команды, спортсмены, матчи,
-- статистические рынки, линии и фактическая статистика.
-- Источник каждой записи (source) — провайдер данных: demo | oddspapi | manual.

create type public.match_status as enum ('SCHEDULED', 'LIVE', 'FINISHED', 'CANCELLED', 'POSTPONED');
create type public.projection_status as enum ('OPEN', 'SUSPENDED', 'SETTLED', 'VOID');

create table public.sports (
  id text primary key check (id ~ '^[a-z_]+$'),
  name text not null,
  sort_order smallint not null default 0,
  is_active boolean not null default true
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  sport_id text not null references public.sports (id),
  code text not null unique check (code ~ '^[A-Z0-9_]+$'),
  name text not null,
  short_name text not null,
  country text,
  logo_url text,
  -- Идентификаторы лиги у внешних провайдеров, например {"oddspapi": "17"}.
  external_ids jsonb not null default '{}'::jsonb,
  sort_order smallint not null default 0,
  is_active boolean not null default true
);

create index leagues_sport_idx on public.leagues (sport_id, sort_order);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  sport_id text not null references public.sports (id),
  name text not null,
  short_name text not null,
  abbr text not null,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text,
  source text not null,
  external_id text not null,
  updated_at timestamptz not null default now(),
  constraint teams_source_external_key unique (source, external_id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  sport_id text not null references public.sports (id),
  team_id uuid references public.teams (id) on delete set null,
  full_name text not null,
  position text,
  jersey_number smallint,
  photo_url text,
  is_active boolean not null default true,
  source text not null,
  external_id text not null,
  updated_at timestamptz not null default now(),
  constraint players_source_external_key unique (source, external_id)
);

create index players_team_idx on public.players (team_id);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id),
  home_team_id uuid not null references public.teams (id),
  away_team_id uuid not null references public.teams (id),
  starts_at timestamptz not null,
  status public.match_status not null default 'SCHEDULED',
  home_score smallint check (home_score >= 0),
  away_score smallint check (away_score >= 0),
  -- Статистика подтверждена: только после этого возможен расчёт прогнозов.
  results_confirmed_at timestamptz,
  settled_at timestamptz,
  source text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_source_external_key unique (source, external_id),
  constraint matches_distinct_teams check (home_team_id <> away_team_id),
  constraint matches_confirmed_only_finished
    check (results_confirmed_at is null or status = 'FINISHED')
);

create index matches_status_starts_idx on public.matches (status, starts_at);
create index matches_league_starts_idx on public.matches (league_id, starts_at);

create trigger matches_touch_updated_at
  before update on public.matches
  for each row execute function private.touch_updated_at();

-- Статистический рынок. components — ключи статистики, сумма которых даёт показатель
-- (например, «Очки + Подборы + Передачи»).
create table public.markets (
  id uuid primary key default gen_random_uuid(),
  sport_id text not null references public.sports (id),
  code text not null check (code ~ '^[a-z_]+$'),
  name text not null,
  short_name text not null,
  components text[] not null check (cardinality(components) > 0),
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  constraint markets_sport_code_key unique (sport_id, code)
);

-- Линия (projection): спортсмен × матч × рынок.
create table public.projections (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  market_id uuid not null references public.markets (id),
  line numeric(6, 1) not null check (line > 0 and line * 2 = trunc(line * 2)),
  status public.projection_status not null default 'OPEN',
  source text not null,
  line_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projections_match_player_market_key unique (match_id, player_id, market_id)
);

create index projections_open_idx on public.projections (match_id) where status = 'OPEN';
create index projections_player_idx on public.projections (player_id);

create trigger projections_touch_updated_at
  before update on public.projections
  for each row execute function private.touch_updated_at();

-- Фактическая статистика спортсмена в матче.
-- did_play = false означает неучастие (прогнозы на спортсмена аннулируются).
create table public.player_statistics (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  did_play boolean not null default true,
  source text not null,
  updated_at timestamptz not null default now(),
  constraint player_statistics_match_player_key unique (match_id, player_id)
);

create trigger player_statistics_touch_updated_at
  before update on public.player_statistics
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Синхронизация с провайдерами
-- ---------------------------------------------------------------------------
create table public.sync_runs (
  id bigint generated always as identity primary key,
  provider text not null,
  job text not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCESS', 'ERROR')),
  items_processed integer not null default 0,
  error text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index sync_runs_started_idx on public.sync_runs (started_at desc);
create index sync_runs_errors_idx on public.sync_runs (started_at desc) where status = 'ERROR';

-- Кэш ответов внешних API, чтобы не тратить платные запросы повторно.
create table public.provider_cache (
  cache_key text primary key,
  provider text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index provider_cache_expires_idx on public.provider_cache (expires_at);
