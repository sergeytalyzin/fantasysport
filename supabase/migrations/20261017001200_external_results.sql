-- PICKUP: результаты от внешних провайдеров статистики (NHL, API-Football, ...).
-- Линии матча могут прийти от одного провайдера (OddsPapi), а статистика —
-- от другого. Связь матча с игрой провайдера сохраняется для проверяемости.

create table public.match_result_links (
  match_id uuid primary key references public.matches (id) on delete cascade,
  provider text not null,
  external_game_id text not null,
  -- Сколько спортсменов с линиями сопоставлено и кто не сопоставлен.
  matched_players integer not null default 0,
  unmatched_players jsonb not null default '[]'::jsonb,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint match_result_links_provider_game_key unique (provider, external_game_id)
);

alter table public.match_result_links enable row level security;
revoke insert, update, delete, truncate on public.match_result_links from anon, authenticated;
create policy "Связи результатов: только администраторы" on public.match_result_links
  for select to authenticated using ((select private.is_admin()));

-- Матчи без подтверждённых результатов для внешних провайдеров статистики:
-- команды и спортсмены с линиями одной выборкой (без N+1).
create or replace function public.matches_awaiting_external_results(
  p_league_codes text[],
  p_min_minutes_after_start integer default 100,
  p_limit integer default 20
)
returns table (
  match_id uuid,
  league_code text,
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
  select m.id, l.code, m.starts_at,
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
   where m.source <> 'demo'
     and l.code = any (p_league_codes)
     and m.results_confirmed_at is null
     and m.status in ('SCHEDULED', 'LIVE', 'FINISHED')
     and m.starts_at < now() - make_interval(mins => p_min_minutes_after_start)
     and m.starts_at > now() - interval '7 days'
   order by m.starts_at
   limit p_limit;
$$;

-- Приём статистики внешнего провайдера для конкретного матча.
-- p_payload: {status, home_score, away_score, confirmed,
--             unmatched: [имена], players: [{player_id, did_play, stats}]}
-- Подтверждённый матч не изменяется; расчёт запускается сразу после подтверждения.
create or replace function public.ingest_match_stats(
  p_match_id uuid,
  p_provider text,
  p_external_game_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_players integer;
  v_confirm boolean := coalesce((p_payload ->> 'confirmed')::boolean, false);
  v_status public.match_status := coalesce((p_payload ->> 'status')::public.match_status, 'FINISHED');
  v_settled integer := 0;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    perform private.raise_error('MATCH_NOT_FOUND', 'Матч не найден');
  end if;
  if v_match.results_confirmed_at is not null or v_match.status = 'CANCELLED' then
    return jsonb_build_object('skipped', 1);
  end if;

  insert into public.player_statistics (match_id, player_id, stats, did_play, source)
  select p_match_id, s.player_id, coalesce(s.stats, '{}'::jsonb), coalesce(s.did_play, true), p_provider
    from jsonb_to_recordset(coalesce(p_payload -> 'players', '[]'::jsonb)) as s(
      player_id uuid, did_play boolean, stats jsonb)
    join public.players pl on pl.id = s.player_id
  on conflict (match_id, player_id) do update
     set stats = excluded.stats, did_play = excluded.did_play, source = excluded.source
   -- Ручной ввод администратора не перезаписывается.
   where public.player_statistics.source <> 'manual';
  get diagnostics v_players = row_count;

  insert into public.match_result_links (match_id, provider, external_game_id, matched_players, unmatched_players)
  values (
    p_match_id, p_provider, p_external_game_id, v_players,
    coalesce(p_payload -> 'unmatched', '[]'::jsonb)
  )
  on conflict (match_id) do update
     set provider = excluded.provider,
         external_game_id = excluded.external_game_id,
         matched_players = excluded.matched_players,
         unmatched_players = excluded.unmatched_players,
         last_checked_at = now();

  update public.matches
     set status = v_status,
         home_score = coalesce((p_payload ->> 'home_score')::smallint, home_score),
         away_score = coalesce((p_payload ->> 'away_score')::smallint, away_score),
         results_confirmed_at = case when v_confirm and v_status = 'FINISHED' then now() end
   where id = p_match_id;

  if v_confirm and v_status = 'FINISHED' then
    v_settled := private.settle_match(p_match_id);
  end if;

  return jsonb_build_object('players', v_players, 'confirmed', v_confirm and v_status = 'FINISHED', 'lineups_settled', v_settled);
end;
$$;

revoke execute on function public.matches_awaiting_external_results(text[], integer, integer) from public, anon, authenticated;
revoke execute on function public.ingest_match_stats(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.matches_awaiting_external_results(text[], integer, integer) to service_role;
grant execute on function public.ingest_match_stats(uuid, text, text, jsonb) to service_role;
