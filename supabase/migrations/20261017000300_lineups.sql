-- PICKUP: купоны прогнозов (lineups), выборы (lineup_selections) и таблица выплат.

create type public.play_type as enum ('POWER', 'FLEX');
create type public.lineup_status as enum ('PENDING', 'WON', 'LOST', 'PARTIALLY_WON', 'VOID', 'REFUNDED');
create type public.pick_direction as enum ('OVER', 'UNDER');
create type public.selection_result as enum ('PENDING', 'WIN', 'LOSS', 'PUSH', 'VOID');

-- Множители выплат. Power Play: только строки correct_count = picks_count.
-- Flex Play: строки для частичных выигрышей. Отсутствие строки = выплата 0.
create table public.payout_rules (
  id uuid primary key default gen_random_uuid(),
  play_type public.play_type not null,
  picks_count smallint not null check (picks_count between 2 and 6),
  correct_count smallint not null check (correct_count between 0 and picks_count),
  multiplier numeric(8, 2) not null check (multiplier >= 0 and multiplier <= 1000),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint payout_rules_key unique (play_type, picks_count, correct_count),
  constraint payout_rules_power_full_only
    check (play_type <> 'POWER' or correct_count = picks_count)
);

create trigger payout_rules_touch_updated_at
  before update on public.payout_rules
  for each row execute function private.touch_updated_at();

create table public.lineups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  play_type public.play_type not null,
  picks_count smallint not null check (picks_count between 2 and 6),
  stake bigint not null check (stake > 0),
  -- Максимальный множитель на момент подтверждения.
  multiplier numeric(8, 2) not null check (multiplier > 0),
  potential_payout bigint not null check (potential_payout > 0),
  -- Снимок условий выплаты на момент подтверждения (используется при расчёте).
  payout_snapshot jsonb not null,
  status public.lineup_status not null default 'PENDING',
  applied_multiplier numeric(8, 2),
  payout bigint check (payout >= 0),
  settled_at timestamptz,
  settlement_note text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint lineups_user_idempotency_key unique (user_id, idempotency_key),
  constraint lineups_settled_consistency check (
    (status = 'PENDING' and settled_at is null and payout is null)
    or (status <> 'PENDING' and settled_at is not null and payout is not null)
  )
);

create index lineups_user_created_idx on public.lineups (user_id, created_at desc);
create index lineups_user_status_idx on public.lineups (user_id, status, created_at desc);
create index lineups_pending_idx on public.lineups (created_at) where status = 'PENDING';

alter table public.wallet_transactions
  add constraint wallet_transactions_lineup_fk
  foreign key (lineup_id) references public.lineups (id) on delete set null;

-- Выбор в купоне. Все отображаемые и расчётные поля — снимок на момент подтверждения.
create table public.lineup_selections (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references public.lineups (id) on delete cascade,
  projection_id uuid not null references public.projections (id),
  match_id uuid not null references public.matches (id),
  player_id uuid not null references public.players (id),
  market_id uuid not null references public.markets (id),
  direction public.pick_direction not null,
  line numeric(6, 1) not null,
  stat_components text[] not null,
  player_name text not null,
  team_abbr text,
  opponent_abbr text,
  market_name text not null,
  league_code text not null,
  match_starts_at timestamptz not null,
  result public.selection_result not null default 'PENDING',
  actual_value numeric(8, 1),
  result_reason text,
  settled_at timestamptz,
  -- Одна линия — один исход: противоположные выборы одной линии запрещены.
  constraint lineup_selections_lineup_projection_key unique (lineup_id, projection_id),
  constraint lineup_selections_lineup_player_key unique (lineup_id, player_id)
);

create index lineup_selections_lineup_idx on public.lineup_selections (lineup_id);
create index lineup_selections_pending_match_idx
  on public.lineup_selections (match_id) where result = 'PENDING';
