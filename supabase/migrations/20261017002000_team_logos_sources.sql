-- PICKUP: логотипы — источник, новые команды без английского названия, обновление.
-- Wikidata ищет и по русскому названию, поэтому name_en больше не обязателен.
-- Найденные логотипы перепроверяются раз в 90 дней (эмблемы меняются при ребрендинге).

alter table public.teams add column logo_source text
  check (logo_source in ('nhl', 'opendota', 'thesportsdb', 'wikidata'));

drop function public.teams_needing_logos(integer);
create function public.teams_needing_logos(p_limit integer default 12)
returns table (team_id uuid, sport_id text, name text, name_en text)
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
  select t.id, t.sport_id, t.name, t.name_en
    from ranked r
    join public.teams t on t.id = r.team_id
   where t.logo_checked_at is null
      or (t.logo_url is null and t.logo_checked_at < now() - interval '30 days')
      or (t.logo_url is not null and t.logo_checked_at < now() - interval '90 days')
   -- Сначала команды без логотипа; обновление найденных — в последнюю очередь.
   order by (t.logo_url is null) desc, r.has_lines desc, r.league_sort, r.next_start
   limit greatest(p_limit, 0);
$$;

-- p_items: [{team_id, logo_url, logo_source}]; logo_url = null — не найден (прежний логотип сохраняется).
create or replace function public.set_team_logos(p_items jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.teams t
       set logo_url = coalesce(i.logo_url, t.logo_url),
           logo_source = case when i.logo_url is not null then i.logo_source else t.logo_source end,
           logo_checked_at = now(),
           updated_at = now()
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(team_id uuid, logo_url text, logo_source text)
     where t.id = i.team_id
    returning 1
  )
  select count(*)::integer from updated;
$$;

revoke execute on function public.teams_needing_logos(integer) from public, anon, authenticated;
grant execute on function public.teams_needing_logos(integer) to service_role;
revoke execute on function public.set_team_logos(jsonb) from public, anon, authenticated;
grant execute on function public.set_team_logos(jsonb) to service_role;

-- Логотипы, найденные до появления logo_source.
update public.teams
   set logo_source = case
         when logo_url like 'https://assets.nhle.com/%' then 'nhl'
         when logo_url like 'https://r2.thesportsdb.com/%' or logo_url like 'https://www.thesportsdb.com/%' then 'thesportsdb'
         when logo_url like 'https://commons.wikimedia.org/%' then 'wikidata'
         else 'opendota'
       end
 where logo_url is not null and logo_source is null and logo_checked_at is not null;
