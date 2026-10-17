-- PICKUP: логотипы команд из открытых источников (NHL API, OpenDota, TheSportsDB).
-- OddsPapi логотипов не отдаёт. Edge Function sports-sync ({"action":"logos"})
-- ищет логотипы небольшими партиями; не найденный логотип перепроверяется через 30 дней.

alter table public.teams add column logo_checked_at timestamptz;

-- Сначала команды с открытыми линиями, затем известные лиги, затем ближайшие матчи.
create or replace function public.teams_needing_logos(p_limit integer default 12)
returns table (team_id uuid, sport_id text, name_en text)
language sql
stable
security definer
set search_path = ''
as $$
  with upcoming as (
    select m.home_team_id, m.away_team_id, m.starts_at, l.sort_order,
           exists (select 1 from public.projections p where p.match_id = m.id and p.status = 'OPEN') as has_lines
      from public.matches m
      join public.leagues l on l.id = m.league_id
     where m.starts_at > now() - interval '3 hours'
       and m.starts_at < now() + interval '3 days'
       and m.status <> 'CANCELLED'
  ), sides as (
    select home_team_id as team_id, starts_at, sort_order, has_lines from upcoming
    union all
    select away_team_id, starts_at, sort_order, has_lines from upcoming
  ), ranked as (
    select team_id, bool_or(has_lines) as has_lines, min(sort_order) as league_sort, min(starts_at) as next_start
      from sides
     group by team_id
  )
  select t.id, t.sport_id, t.name_en
    from ranked r
    join public.teams t on t.id = r.team_id
   where t.logo_url is null
     and t.name_en is not null
     and (t.logo_checked_at is null or t.logo_checked_at < now() - interval '30 days')
   order by r.has_lines desc, r.league_sort, r.next_start
   limit greatest(p_limit, 0);
$$;

-- p_items: [{team_id, logo_url}]; logo_url = null — проверено, логотип не найден.
create or replace function public.set_team_logos(p_items jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.teams t
       set logo_url = coalesce(i.logo_url, t.logo_url),
           logo_checked_at = now(),
           updated_at = now()
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(team_id uuid, logo_url text)
     where t.id = i.team_id
    returning 1
  )
  select count(*)::integer from updated;
$$;

revoke execute on function public.teams_needing_logos(integer) from public, anon, authenticated;
grant execute on function public.teams_needing_logos(integer) to service_role;
revoke execute on function public.set_team_logos(jsonb) from public, anon, authenticated;
grant execute on function public.set_team_logos(jsonb) to service_role;

-- Отдельная задача: поиск логотипов не задерживает синхронизацию линий.
do $logos$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_net/pg_cron/vault not available — skipping team logos schedule';
    return;
  end if;

  perform cron.schedule(
    'pickup-team-logos',
    '*/10 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_functions_url')
               || '/sports-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_cron_secret')
        ),
        body := '{"action":"logos"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$
  );
end;
$logos$;
