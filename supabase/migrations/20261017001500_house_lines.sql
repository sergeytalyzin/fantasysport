-- PICKUP: собственные линии («линии PICKUP») для лиг без линий букмекеров на игроков.
-- Линия = x.5 у средней игрока: свежая форма (stat_history) + прошлый сезон (stat_priors).
-- Таблицы служебные: пишет только Edge Function (service_role), читает админ.

-- Статистика игроков во всех матчах лиги (а не только в матчах с линиями).
create table public.stat_history (
  provider text not null,
  league_code text not null references public.leagues (code),
  player_external_id text not null,
  player_name text not null,
  team_external_id text not null,
  fixture_external_id text not null,
  played_at timestamptz not null,
  minutes smallint not null check (minutes >= 0),
  stats jsonb not null check (jsonb_typeof(stats) = 'object'),
  created_at timestamptz not null default now(),
  primary key (provider, player_external_id, fixture_external_id)
);

create index stat_history_player_idx on public.stat_history (provider, player_external_id, played_at desc);

-- Итоги прошлого сезона по игроку — стартовая оценка, пока не накопилась форма.
create table public.stat_priors (
  provider text not null,
  league_code text not null references public.leagues (code),
  season smallint not null,
  player_external_id text not null,
  player_name text not null,
  appearances smallint not null check (appearances >= 0),
  minutes integer not null check (minutes >= 0),
  totals jsonb not null check (jsonb_typeof(totals) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (provider, season, player_external_id)
);

alter table public.stat_history enable row level security;
alter table public.stat_priors enable row level security;
revoke insert, update, delete, truncate on public.stat_history, public.stat_priors from anon, authenticated;
create policy "История статистики: только администраторы" on public.stat_history
  for select to authenticated using ((select private.is_admin()));
create policy "Итоги сезона: только администраторы" on public.stat_priors
  for select to authenticated using ((select private.is_admin()));
