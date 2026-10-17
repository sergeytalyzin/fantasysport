-- PICKUP: фотографии спортсменов из официальных источников лиг и Wikimedia Commons.
-- Поиск выполняет Edge Function sports-sync ({"action":"photos"}) по расписанию,
-- а не при отображении. Для фото с Commons хранятся лицензия и автор (указываются на сайте).

alter table public.players
  add column photo_source text check (photo_source in ('nhl', 'nba', 'sportmonks', 'wikimedia')),
  add column photo_license text,
  add column photo_author text,
  add column photo_license_url text,
  add column photo_page_url text,
  -- ID спортсмена в источнике фото (NHL playerId, NBA personId, Sportmonks id).
  add column external_player_id text,
  add column photo_checked_at timestamptz;

-- Сначала спортсмены с открытыми линиями; без фото — повторно через 7 дней,
-- найденные фото перепроверяются раз в 14 дней (смена клуба, недоступный адрес).
create or replace function public.players_needing_photos(p_limit integer default 10)
returns table (
  player_id uuid,
  sport_id text,
  full_name text,
  league_codes text[],
  team_names text[],
  photo_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  with recent as (
    select p.player_id, bool_or(p.status = 'OPEN') as has_open, max(m.starts_at) as last_start,
           array_agg(distinct l.code) as league_codes,
           array_agg(distinct coalesce(h.name_en, h.name)) || array_agg(distinct coalesce(a.name_en, a.name)) as team_names
      from public.projections p
      join public.matches m on m.id = p.match_id
      join public.leagues l on l.id = m.league_id
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
     where m.starts_at > now() - interval '30 days'
     group by p.player_id
  )
  select pl.id, pl.sport_id, pl.full_name, r.league_codes,
         array(select distinct unnest(r.team_names)), pl.photo_url
    from recent r
    join public.players pl on pl.id = r.player_id
   where pl.photo_checked_at is null
      or (pl.photo_url is null and pl.photo_checked_at < now() - interval '7 days')
      or (pl.photo_url is not null and pl.photo_checked_at < now() - interval '14 days')
   order by (pl.photo_checked_at is null) desc, r.has_open desc, r.last_start desc
   limit greatest(p_limit, 0);
$$;

-- p_items: [{player_id, found, keep, photo_url, photo_source, external_player_id,
--            photo_license, photo_author, photo_license_url, photo_page_url}]
create or replace function public.set_player_photos(p_items jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.players pl
       set photo_url = case when i.found then i.photo_url when i.keep then pl.photo_url end,
           photo_source = case when i.found then i.photo_source when i.keep then pl.photo_source end,
           external_player_id = case when i.found then i.external_player_id when i.keep then pl.external_player_id end,
           photo_license = case when i.found then i.photo_license when i.keep then pl.photo_license end,
           photo_author = case when i.found then i.photo_author when i.keep then pl.photo_author end,
           photo_license_url = case when i.found then i.photo_license_url when i.keep then pl.photo_license_url end,
           photo_page_url = case when i.found then i.photo_page_url when i.keep then pl.photo_page_url end,
           photo_checked_at = now(),
           updated_at = now()
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(
        player_id uuid, found boolean, keep boolean, photo_url text, photo_source text, external_player_id text,
        photo_license text, photo_author text, photo_license_url text, photo_page_url text)
     where pl.id = i.player_id
    returning 1
  )
  select count(*)::integer from updated;
$$;

revoke execute on function public.players_needing_photos(integer) from public, anon, authenticated;
grant execute on function public.players_needing_photos(integer) to service_role;
revoke execute on function public.set_player_photos(jsonb) from public, anon, authenticated;
grant execute on function public.set_player_photos(jsonb) to service_role;

do $photos$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_net/pg_cron/vault not available — skipping player photos schedule';
    return;
  end if;

  perform cron.schedule(
    'pickup-player-photos',
    '5-59/10 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_functions_url')
               || '/sports-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pickup_cron_secret')
        ),
        body := '{"action":"photos"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$
  );
end;
$photos$;
