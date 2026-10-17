-- PICKUP: Row Level Security и права.
-- Принцип: клиент (anon/authenticated) только ЧИТАЕТ разрешённые строки.
-- Любые изменения — через security definer RPC. Исключение: никнейм и аватар профиля.

-- ---------------------------------------------------------------------------
-- 1. Включаем RLS на всех таблицах
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.monthly_bonus_grants enable row level security;
alter table public.user_stats enable row level security;
alter table public.monthly_user_stats enable row level security;
alter table public.leaderboard_snapshots enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.sports enable row level security;
alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.markets enable row level security;
alter table public.projections enable row level security;
alter table public.player_statistics enable row level security;
alter table public.sync_runs enable row level security;
alter table public.provider_cache enable row level security;
alter table public.payout_rules enable row level security;
alter table public.lineups enable row level security;
alter table public.lineup_selections enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Права на уровне таблиц: запрещаем клиентские INSERT/UPDATE/DELETE везде
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;

-- Единственное прямое изменение с клиента — никнейм и аватар своего профиля.
grant update (nickname, avatar_url) on public.profiles to authenticated;

-- Служебные таблицы недоступны клиенту даже на чтение.
revoke select on public.provider_cache from anon, authenticated;

-- Новые таблицы в будущих миграциях тоже не получат прав на запись по умолчанию.
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Политики чтения
-- ---------------------------------------------------------------------------

-- Публичный справочник (доступен и гостям — витрина линий открыта).
create policy "Справочник: чтение всем" on public.sports for select using (true);
create policy "Справочник: чтение всем" on public.leagues for select using (true);
create policy "Справочник: чтение всем" on public.teams for select using (true);
create policy "Справочник: чтение всем" on public.players for select using (true);
create policy "Справочник: чтение всем" on public.matches for select using (true);
create policy "Справочник: чтение всем" on public.markets for select using (true);
create policy "Справочник: чтение всем" on public.projections for select using (true);
create policy "Справочник: чтение всем" on public.player_statistics for select using (true);
create policy "Справочник: чтение всем" on public.payout_rules for select using (true);
create policy "Справочник: чтение всем" on public.app_settings for select using (true);
create policy "Архив рейтинга: чтение всем" on public.leaderboard_snapshots for select using (true);

-- Профили: никнеймы и аватары публичны (рейтинг), изменение — только своего.
create policy "Профили: чтение всем" on public.profiles for select using (true);
create policy "Профили: изменение своего" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Финансы и прогнозы: только свои строки (или администратор).
create policy "Кошелёк: чтение своего" on public.wallets
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "Операции: чтение своих" on public.wallet_transactions
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "Бонусы: чтение своих" on public.monthly_bonus_grants
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "Статистика: чтение своей" on public.user_stats
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "Статистика месяца: чтение своей" on public.monthly_user_stats
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "Купоны: чтение своих" on public.lineups
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy "Выборы: чтение своих" on public.lineup_selections
  for select to authenticated
  using (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_id
         and (l.user_id = (select auth.uid()) or (select private.is_admin()))
    )
  );

-- Только администраторы.
create policy "Аудит: только администраторы" on public.admin_audit_logs
  for select to authenticated using ((select private.is_admin()));
create policy "Синхронизация: только администраторы" on public.sync_runs
  for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Права на функции
-- ---------------------------------------------------------------------------
-- По умолчанию PostgreSQL даёт EXECUTE всем — убираем и выдаём точечно.
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- RLS-политики вызывают private.is_admin() от имени клиента.
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin(uuid) to anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.create_lineup(public.play_type, bigint, jsonb, numeric, text) to authenticated;
grant execute on function public.get_overall_leaderboard(text, integer, integer) to anon, authenticated;
grant execute on function public.get_monthly_leaderboard(integer, integer, text, integer, integer) to anon, authenticated;
grant execute on function public.get_leaderboard_periods() to anon, authenticated;
grant execute on function public.get_my_overall_rank() to authenticated;
grant execute on function public.get_my_monthly_rank(integer, integer) to authenticated;
grant execute on function public.get_my_profile_summary() to authenticated;

-- Административные RPC: доступ проверяется внутри через private.require_admin().
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
grant execute on function public.admin_adjust_balance(uuid, bigint, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;
grant execute on function public.admin_upsert_payout_rule(public.play_type, smallint, smallint, numeric, boolean) to authenticated;
grant execute on function public.admin_update_projection(uuid, numeric, public.projection_status) to authenticated;
grant execute on function public.admin_create_projection(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.admin_set_match_status(uuid, public.match_status, smallint, smallint) to authenticated;
grant execute on function public.admin_upsert_player_stats(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.admin_confirm_match_results(uuid) to authenticated;
grant execute on function public.admin_settle_ready_matches() to authenticated;
grant execute on function public.admin_refund_lineup(uuid, text) to authenticated;
grant execute on function public.admin_run_monthly_bonuses() to authenticated;

-- Приём данных от провайдеров — только service_role (Edge Function).
grant execute on function public.ingest_slate(text, jsonb) to service_role;
grant execute on function public.ingest_results(text, jsonb) to service_role;
grant execute on function public.matches_awaiting_results(text, integer) to service_role;
grant usage on schema private to service_role;
grant execute on function private.settle_ready_matches() to service_role;
