-- PICKUP: приём данных от провайдеров. Вызывается только Edge Function
-- с service_role: один RPC на пакет данных вместо запросов на каждую запись.

-- p_payload: {
--   "teams":   [{external_id, sport_id, name, short_name, abbr, color, logo_url}],
--   "players": [{external_id, sport_id, team_external_id, full_name, position, jersey_number, photo_url}],
--   "matches": [{external_id, league_code, home_team_external_id, away_team_external_id, starts_at, status}],
--   "projections": [{match_external_id, player_external_id, market_code, line}]
-- }
create or replace function public.ingest_slate(p_source text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teams integer;
  v_players integer;
  v_matches integer;
  v_projections integer;
begin
  insert into public.teams (sport_id, name, short_name, abbr, color, logo_url, source, external_id)
  select t.sport_id, t.name, coalesce(t.short_name, t.name), t.abbr, t.color, t.logo_url,
         p_source, t.external_id
    from jsonb_to_recordset(coalesce(p_payload -> 'teams', '[]'::jsonb)) as t(
      external_id text, sport_id text, name text, short_name text, abbr text,
      color text, logo_url text)
  on conflict (source, external_id) do update
     set name = excluded.name, short_name = excluded.short_name, abbr = excluded.abbr,
         color = coalesce(excluded.color, public.teams.color),
         logo_url = coalesce(excluded.logo_url, public.teams.logo_url),
         updated_at = now();
  get diagnostics v_teams = row_count;

  insert into public.players (
    sport_id, team_id, full_name, position, jersey_number, photo_url, source, external_id
  )
  select pl.sport_id, t.id, pl.full_name, pl.position, pl.jersey_number, pl.photo_url,
         p_source, pl.external_id
    from jsonb_to_recordset(coalesce(p_payload -> 'players', '[]'::jsonb)) as pl(
      external_id text, sport_id text, team_external_id text, full_name text,
      position text, jersey_number smallint, photo_url text)
    left join public.teams t on t.source = p_source and t.external_id = pl.team_external_id
  on conflict (source, external_id) do update
     set team_id = excluded.team_id, full_name = excluded.full_name,
         position = excluded.position, jersey_number = excluded.jersey_number,
         photo_url = coalesce(excluded.photo_url, public.players.photo_url),
         updated_at = now();
  get diagnostics v_players = row_count;

  insert into public.matches (league_id, home_team_id, away_team_id, starts_at, status, source, external_id)
  select l.id, h.id, a.id, m.starts_at, coalesce(m.status, 'SCHEDULED'), p_source, m.external_id
    from jsonb_to_recordset(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m(
      external_id text, league_code text, home_team_external_id text,
      away_team_external_id text, starts_at timestamptz, status public.match_status)
    join public.leagues l on l.code = m.league_code
    join public.teams h on h.source = p_source and h.external_id = m.home_team_external_id
    join public.teams a on a.source = p_source and a.external_id = m.away_team_external_id
  on conflict (source, external_id) do update
     set starts_at = excluded.starts_at,
         status = excluded.status
   where public.matches.results_confirmed_at is null
     and public.matches.status not in ('FINISHED', 'CANCELLED');
  get diagnostics v_matches = row_count;

  insert into public.projections (match_id, player_id, market_id, line, source)
  select m.id, pl.id, mk.id, pr.line, p_source
    from jsonb_to_recordset(coalesce(p_payload -> 'projections', '[]'::jsonb)) as pr(
      match_external_id text, player_external_id text, market_code text, line numeric)
    join public.matches m on m.source = p_source and m.external_id = pr.match_external_id
    join public.leagues l on l.id = m.league_id
    join public.players pl on pl.source = p_source and pl.external_id = pr.player_external_id
    join public.markets mk on mk.sport_id = l.sport_id and mk.code = pr.market_code
   where m.status = 'SCHEDULED' and m.starts_at > now()
  on conflict (match_id, player_id, market_id) do update
     set line = excluded.line,
         line_updated_at = case when public.projections.line <> excluded.line
                                then now() else public.projections.line_updated_at end
   where public.projections.status = 'OPEN'
     and public.projections.source <> 'manual'
     and public.projections.line <> excluded.line;
  get diagnostics v_projections = row_count;

  return jsonb_build_object(
    'teams', v_teams, 'players', v_players,
    'matches', v_matches, 'projections', v_projections
  );
end;
$$;

-- p_payload: {"matches": [{external_id, status, home_score, away_score, confirmed,
--               "players": [{external_id, did_play, stats: {...}}]}]}
-- Матчи с уже подтверждёнными результатами не изменяются (повторный запрос
-- результатов безопасен). Расчёт запускается сразу после подтверждения.
create or replace function public.ingest_results(p_source text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_match public.matches;
  v_updated integer := 0;
  v_settled integer := 0;
begin
  for r in
    select *
      from jsonb_to_recordset(coalesce(p_payload -> 'matches', '[]'::jsonb)) as x(
        external_id text, status public.match_status, home_score smallint,
        away_score smallint, confirmed boolean, players jsonb)
  loop
    select * into v_match from public.matches
     where source = p_source and external_id = r.external_id
     for update;
    continue when not found
      or v_match.results_confirmed_at is not null
      or v_match.status = 'CANCELLED';

    insert into public.player_statistics (match_id, player_id, stats, did_play, source)
    select v_match.id, pl.id, coalesce(s.stats, '{}'::jsonb), coalesce(s.did_play, true), p_source
      from jsonb_to_recordset(coalesce(r.players, '[]'::jsonb)) as s(
        external_id text, did_play boolean, stats jsonb)
      join public.players pl on pl.source = p_source and pl.external_id = s.external_id
    on conflict (match_id, player_id) do update
       set stats = excluded.stats, did_play = excluded.did_play, source = excluded.source;

    update public.matches
       set status = coalesce(r.status, status),
           home_score = coalesce(r.home_score, home_score),
           away_score = coalesce(r.away_score, away_score),
           results_confirmed_at = case
             when coalesce(r.confirmed, false) and coalesce(r.status, status) = 'FINISHED'
             then now() end
     where id = v_match.id;
    v_updated := v_updated + 1;

    v_settled := v_settled + private.settle_match(v_match.id);
  end loop;

  return jsonb_build_object('matches', v_updated, 'lineups_settled', v_settled);
end;
$$;

-- Матчи источника, для которых нужно запросить результаты.
create or replace function public.matches_awaiting_results(p_source text, p_limit integer default 50)
returns table (match_id uuid, external_id text, league_code text, starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.external_id, l.code, m.starts_at
    from public.matches m
    join public.leagues l on l.id = m.league_id
   where m.source = p_source
     and m.results_confirmed_at is null
     and m.status in ('SCHEDULED', 'LIVE', 'FINISHED')
     and m.starts_at < now()
   order by m.starts_at
   limit p_limit;
$$;
