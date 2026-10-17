-- PICKUP: английские названия команд для сопоставления с источниками результатов.
-- Расписание загружается на русском (для пользователей), а NHL API, OpenDota и
-- API-Football называют команды по-английски. Английские названия приходят в
-- ответе /odds, который и так запрашивается для линий, — без лишних запросов.

alter table public.teams
  add column name_en text,
  add column abbr_en text;

-- Команды, загруженные до перехода расписания на русский, названы по-английски.
update public.teams set name_en = name, abbr_en = abbr
 where source = 'oddspapi' and name_en is null;

-- p_items: [{external_id, name_en, abbr_en}]
create or replace function public.set_team_names_en(p_source text, p_items jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.teams t
       set name_en = i.name_en, abbr_en = coalesce(i.abbr_en, t.abbr_en)
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(external_id text, name_en text, abbr_en text)
     where t.source = p_source and t.external_id = i.external_id
       and t.name_en is distinct from i.name_en
    returning 1
  )
  select count(*)::integer from updated;
$$;

revoke execute on function public.set_team_names_en(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_team_names_en(text, jsonb) to service_role;

-- Сопоставление результатов — по английским названиям, если они известны.
create or replace function public.matches_awaiting_external_results(
  p_league_codes text[],
  p_min_minutes_after_start integer default 100,
  p_limit integer default 20,
  p_sport_ids text[] default '{}'
)
returns table (
  match_id uuid,
  league_code text,
  sport_id text,
  starts_at timestamptz,
  home jsonb,
  away jsonb,
  players jsonb,
  link jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, l.code, l.sport_id, m.starts_at,
         jsonb_build_object('name', coalesce(h.name_en, h.name), 'short_name', h.short_name, 'abbr', coalesce(h.abbr_en, h.abbr)),
         jsonb_build_object('name', coalesce(a.name_en, a.name), 'short_name', a.short_name, 'abbr', coalesce(a.abbr_en, a.abbr)),
         coalesce((
           select jsonb_agg(distinct jsonb_build_object('player_id', pl.id, 'full_name', pl.full_name))
             from public.projections p
             join public.players pl on pl.id = p.player_id
            where p.match_id = m.id
         ), '[]'::jsonb),
         (select to_jsonb(k) from public.match_result_links k where k.match_id = m.id)
    from public.matches m
    join public.leagues l on l.id = m.league_id
    join public.teams h on h.id = m.home_team_id
    join public.teams a on a.id = m.away_team_id
   where (l.code = any (p_league_codes) or l.sport_id = any (p_sport_ids))
     and exists (select 1 from public.projections p where p.match_id = m.id)
     and m.results_confirmed_at is null
     and m.status in ('SCHEDULED', 'LIVE', 'FINISHED')
     and m.starts_at < now() - make_interval(mins => p_min_minutes_after_start)
     and m.starts_at > now() - interval '7 days'
   order by m.starts_at
   limit p_limit;
$$;
