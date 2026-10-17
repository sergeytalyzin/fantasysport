-- PICKUP: полное расписание реальных событий из OddsPapi.
-- Один запрос на вид спорта отдаёт все матчи всех турниров за окно дат
-- (проверено: футбол — 1760 матчей из 412 турниров за сутки). Турниры
-- создаются автоматически. Линии на игроков загружаются только там, где их дают
-- букмекеры (leagues.props_enabled / турниры первого эшелона в киберспорте).

alter table public.sports
  add column oddspapi_sport_id integer unique,
  add column schedule_enabled boolean not null default false;

update public.sports set oddspapi_sport_id = 10, schedule_enabled = true where id = 'football';
update public.sports set oddspapi_sport_id = 11, schedule_enabled = true where id = 'basketball';
update public.sports set oddspapi_sport_id = 15, schedule_enabled = true where id = 'hockey';
update public.sports set oddspapi_sport_id = 16, schedule_enabled = true where id = 'dota';
update public.sports set oddspapi_sport_id = 17, schedule_enabled = true where id = 'cs';

-- ID видов спорта — из GET /v4/sports.
insert into public.sports (id, name, sort_order, oddspapi_sport_id, schedule_enabled) values
  ('tennis', 'Теннис', 6, 12, true),
  ('volleyball', 'Волейбол', 7, 23, true),
  ('handball', 'Гандбол', 8, 22, true),
  ('baseball', 'Бейсбол', 9, 13, false),
  ('american_football', 'Американский футбол', 10, 14, false),
  ('mma', 'ММА', 11, 20, false),
  ('boxing', 'Бокс', 12, 21, false),
  ('table_tennis', 'Настольный теннис', 13, 25, false),
  ('rugby', 'Регби', 14, 26, false),
  ('cricket', 'Крикет', 15, 27, false),
  ('futsal', 'Футзал', 16, 29, false),
  ('darts', 'Дартс', 17, 19, false),
  ('snooker', 'Снукер', 18, 24, false),
  ('lol', 'League of Legends', 19, 18, false),
  ('valorant', 'Valorant', 20, 61, false)
on conflict (id) do nothing;

alter table public.leagues add column props_enabled boolean not null default false;

-- Известные лиги — их турниры в OddsPapi (проверено по GET /v4/tournaments),
-- чтобы расписание попадало в них, а не создавало дубли.
update public.leagues set external_ids = external_ids || jsonb_build_object('oddspapi', v.tid)
  from (values ('NHL', '234'), ('NBA', '132'), ('EPL', '17'), ('UCL', '7'), ('RPL', '203'), ('KHL', '268'))
       as v(code, tid)
 where public.leagues.code = v.code;

-- Один турнир OddsPapi — одна лига.
create unique index leagues_oddspapi_tournament_key on public.leagues ((external_ids ->> 'oddspapi'))
  where external_ids ? 'oddspapi';

-- Линии на игроков сейчас берутся для НХЛ: по ней есть и линии, и автоматические
-- результаты. Остальные лиги включаются в админке, когда появится источник результатов.
update public.leagues set props_enabled = true where code = 'NHL';
-- Киберспорт теперь раскладывается по реальным турнирам; общие «лиги» больше не нужны.
update public.leagues set is_active = false where code in ('DOTA2', 'CS2');

-- p_payload: {
--   "leagues": [{tournament_id, sport_id, name, country}],
--   "teams":   [{external_id, sport_id, name, short_name, abbr}],
--   "matches": [{external_id, tournament_id, home_team_external_id, away_team_external_id, starts_at, status}]
-- }
create or replace function public.ingest_schedule(p_source text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leagues integer;
  v_teams integer;
  v_matches integer;
begin
  insert into public.leagues (sport_id, code, name, short_name, country, external_ids, sort_order)
  select distinct on (l.tournament_id)
         l.sport_id, 'OP_' || l.tournament_id, l.name, l.name, l.country,
         jsonb_build_object('oddspapi', l.tournament_id), 100
    from jsonb_to_recordset(coalesce(p_payload -> 'leagues', '[]'::jsonb)) as l(
      tournament_id text, sport_id text, name text, country text)
    join public.sports s on s.id = l.sport_id
   where not exists (
     select 1 from public.leagues x where x.external_ids ->> 'oddspapi' = l.tournament_id
   )
  on conflict do nothing;
  get diagnostics v_leagues = row_count;

  insert into public.teams (sport_id, name, short_name, abbr, source, external_id)
  select t.sport_id, t.name, coalesce(t.short_name, t.name), t.abbr, p_source, t.external_id
    from jsonb_to_recordset(coalesce(p_payload -> 'teams', '[]'::jsonb)) as t(
      external_id text, sport_id text, name text, short_name text, abbr text)
  on conflict (source, external_id) do update
     set name = excluded.name, short_name = excluded.short_name, abbr = excluded.abbr, updated_at = now()
   where (public.teams.name, public.teams.short_name, public.teams.abbr)
         is distinct from (excluded.name, excluded.short_name, excluded.abbr);
  get diagnostics v_teams = row_count;

  insert into public.matches (league_id, home_team_id, away_team_id, starts_at, status, source, external_id)
  select l.id, h.id, a.id, m.starts_at, m.status, p_source, m.external_id
    from jsonb_to_recordset(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m(
      external_id text, tournament_id text, home_team_external_id text,
      away_team_external_id text, starts_at timestamptz, status public.match_status)
    join public.leagues l on l.external_ids ->> 'oddspapi' = m.tournament_id
    join public.teams h on h.source = p_source and h.external_id = m.home_team_external_id
    join public.teams a on a.source = p_source and a.external_id = m.away_team_external_id
   where h.id <> a.id
  on conflict (source, external_id) do update
     set starts_at = excluded.starts_at,
         status = excluded.status
   where public.matches.results_confirmed_at is null
     and public.matches.status not in ('FINISHED', 'CANCELLED')
     and (public.matches.starts_at, public.matches.status) is distinct from (excluded.starts_at, excluded.status);
  get diagnostics v_matches = row_count;

  return jsonb_build_object('leagues', v_leagues, 'teams', v_teams, 'matches', v_matches);
end;
$$;

revoke execute on function public.ingest_schedule(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_schedule(text, jsonb) to service_role;

-- Результаты нужны только матчам, на которые были линии; провайдер может
-- обслуживать вид спорта целиком (Dota 2 — любые турниры).
drop function public.matches_awaiting_external_results(text[], integer, integer);
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
         jsonb_build_object('name', h.name, 'short_name', h.short_name, 'abbr', h.abbr),
         jsonb_build_object('name', a.name, 'short_name', a.short_name, 'abbr', a.abbr),
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

revoke execute on function public.matches_awaiting_external_results(text[], integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.matches_awaiting_external_results(text[], integer, integer, text[]) to service_role;
