-- PICKUP: обновление названий автоматически созданных турниров при загрузке расписания.

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

  -- Названия автоматически созданных турниров обновляются (например, на русские).
  update public.leagues x
     set name = l.name, short_name = l.name, country = l.country
    from jsonb_to_recordset(coalesce(p_payload -> 'leagues', '[]'::jsonb)) as l(
      tournament_id text, sport_id text, name text, country text)
   where x.external_ids ->> 'oddspapi' = l.tournament_id
     and x.code = 'OP_' || l.tournament_id
     and (x.name, x.country) is distinct from (l.name, l.country);

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

