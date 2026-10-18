-- PICKUP: пересчёт линий PICKUP закрывает устаревшие линии матча.
-- Раньше линия игрока, выпавшего из основы или из числа лучших по форме,
-- оставалась открытой со старым значением.

create or replace function public.ingest_house_lines(p_source text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_players integer;
  v_projections integer;
  v_suspended integer;
begin
  with items as (
    select (m ->> 'match_id')::uuid as match_id, m
      from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
  )
  insert into public.players (sport_id, team_id, full_name, position, jersey_number, source, external_id)
  select distinct on (pl.external_id) l.sport_id, pl.team_id, pl.full_name, pl.position, pl.jersey_number, p_source, pl.external_id
    from items i
    join public.matches mt on mt.id = i.match_id
    join public.leagues l on l.id = mt.league_id
    cross join lateral jsonb_to_recordset(coalesce(i.m -> 'players', '[]'::jsonb)) as pl(
      external_id text, team_id uuid, full_name text, position text, jersey_number smallint)
   -- Спортсмен может играть только за одну из команд матча.
   where pl.team_id in (mt.home_team_id, mt.away_team_id)
  on conflict (source, external_id) do update
     set team_id = excluded.team_id, full_name = excluded.full_name,
         position = excluded.position, jersey_number = excluded.jersey_number,
         updated_at = now();
  get diagnostics v_players = row_count;

  with items as (
    select (m ->> 'match_id')::uuid as match_id, m
      from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
  )
  insert into public.projections (match_id, player_id, market_id, line, source)
  select mt.id, pl.id, mk.id, pr.line, p_source
    from items i
    join public.matches mt on mt.id = i.match_id
    join public.leagues l on l.id = mt.league_id
    cross join lateral jsonb_to_recordset(coalesce(i.m -> 'projections', '[]'::jsonb)) as pr(
      player_external_id text, market_code text, line numeric)
    join public.players pl on pl.source = p_source and pl.external_id = pr.player_external_id
    join public.markets mk on mk.sport_id = l.sport_id and mk.code = pr.market_code
   where mt.status = 'SCHEDULED' and mt.starts_at > now()
  on conflict (match_id, player_id, market_id) do update
     set line = excluded.line,
         status = 'OPEN',
         line_updated_at = case when public.projections.line <> excluded.line
                                then now() else public.projections.line_updated_at end
   where public.projections.status in ('OPEN', 'SUSPENDED')
     and public.projections.source = p_source
     and (public.projections.line <> excluded.line or public.projections.status = 'SUSPENDED');
  get diagnostics v_projections = row_count;

  -- Линии матча, которых нет в новом наборе (игрок выпал из основы или из числа лучших),
  -- приостанавливаются: на витрине их нет, уже принятые прогнозы рассчитываются как обычно.
  with items as (
    select (m ->> 'match_id')::uuid as match_id, m
      from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
  ), fresh as (
    select i.match_id, pl.id as player_id, mk.id as market_id
      from items i
      join public.matches mt on mt.id = i.match_id
      join public.leagues l on l.id = mt.league_id
      cross join lateral jsonb_to_recordset(coalesce(i.m -> 'projections', '[]'::jsonb)) as pr(
        player_external_id text, market_code text, line numeric)
      join public.players pl on pl.source = p_source and pl.external_id = pr.player_external_id
      join public.markets mk on mk.sport_id = l.sport_id and mk.code = pr.market_code
  )
  update public.projections p
     set status = 'SUSPENDED'
   where p.source = p_source
     and p.status = 'OPEN'
     and p.match_id in (select match_id from items)
     and (p.match_id, p.player_id, p.market_id) not in (select match_id, player_id, market_id from fresh);
  get diagnostics v_suspended = row_count;

  return jsonb_build_object('players', v_players, 'projections', v_projections, 'suspended', v_suspended);
end;
$$;

revoke execute on function public.ingest_house_lines(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_house_lines(text, jsonb) to service_role;
