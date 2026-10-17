-- PICKUP: Storage, Realtime и плановые задачи (Supabase Cron).
-- Блоки защищены проверками, чтобы миграции применялись и в «голом» PostgreSQL
-- (интеграционные тесты), где нет схем storage/cron и публикации Realtime.

-- Обёртка для Edge Function: плановый расчёт без доступа к схеме private.
create or replace function public.service_settle_ready_matches()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.settle_ready_matches();
$$;
revoke execute on function public.service_settle_ready_matches() from public, anon, authenticated;
grant execute on function public.service_settle_ready_matches() to service_role;

-- Ежечасное обслуживание: догоняющее начисление бонусов и архив рейтингов.
create or replace function private.run_hourly_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bonuses integer;
  v_snapshots integer;
  v_settled integer;
begin
  v_bonuses := private.grant_monthly_bonuses();
  v_snapshots := private.snapshot_monthly_leaderboards();
  v_settled := private.settle_ready_matches();
  return jsonb_build_object('bonuses', v_bonuses, 'snapshots', v_snapshots, 'settled', v_settled);
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: аватары пользователей и фото спортсменов
-- ---------------------------------------------------------------------------
do $storage$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not found — skipping buckets';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
    ('player-photos', 'player-photos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

  -- Пользователь пишет только в папку со своим id: avatars/<uid>/...
  execute $p$
    create policy "Аватары: загрузка в свою папку" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
  execute $p$
    create policy "Аватары: изменение своих" on storage.objects
      for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
  execute $p$
    create policy "Аватары: удаление своих" on storage.objects
      for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
  execute $p$
    create policy "Фото спортсменов: загрузка администратором" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'player-photos' and (select private.is_admin()))
  $p$;
end;
$storage$;

-- ---------------------------------------------------------------------------
-- Realtime: только собственный кошелёк и купоны (RLS фильтрует строки).
-- Рейтинг намеренно НЕ транслируется — он обновляется по запросу клиента.
-- ---------------------------------------------------------------------------
do $realtime$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found — skipping';
    return;
  end if;
  alter publication supabase_realtime add table public.wallets, public.lineups;
end;
$realtime$;

-- ---------------------------------------------------------------------------
-- Supabase Cron (pg_cron работает в UTC).
-- 00:00 МСК 1-го числа = 21:00 UTC последнего дня предыдущего месяца
-- (в России нет перехода на летнее время, смещение всегда +3).
-- pg_cron не умеет «последний день месяца», поэтому задача запускается
-- 28–31 числа в 21:00 UTC; функция идемпотентна и начисляет только тогда,
-- когда в Москве наступил новый месяц.
-- ---------------------------------------------------------------------------
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available — skipping schedules';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  grant usage on schema cron to postgres;

  perform cron.schedule(
    'pickup-monthly-bonus',
    '0 21 28-31 * *',
    'select private.grant_monthly_bonuses()'
  );
  -- Догоняющий запуск после простоя + архив рейтингов + расчёт готовых матчей.
  perform cron.schedule(
    'pickup-hourly-maintenance',
    '7 * * * *',
    'select private.run_hourly_maintenance()'
  );
  perform cron.schedule(
    'pickup-settlement',
    '*/5 * * * *',
    'select private.settle_ready_matches()'
  );
end;
$cron$;

-- Синхронизация спортивных данных вызывает Edge Function через pg_net.
-- URL и секрет хранятся в Supabase Vault (см. README, раздел «Cron»).
do $sync$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_net/pg_cron/vault not available — skipping sports sync schedule';
    return;
  end if;

  create extension if not exists pg_net with schema extensions;

  perform cron.schedule(
    'pickup-sports-sync',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_functions_url')
               || '/sports-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_cron_secret')
        ),
        body := '{"action":"sync"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$
  );
end;
$sync$;
