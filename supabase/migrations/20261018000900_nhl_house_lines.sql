-- PICKUP: линии PICKUP на все матчи НХЛ по статистике BALLDONTLIE.
-- Отдельная задача Cron, чтобы не задерживать синхронизацию футбола и результатов.

do $nhl$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_net/pg_cron/vault not available — skipping NHL lines schedule';
    return;
  end if;

  perform cron.schedule(
    'pickup-nhl-lines',
    '25 */3 * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_functions_url')
               || '/sports-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_cron_secret')
        ),
        body := '{"action":"nhl_lines"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$
  );
end;
$nhl$;
