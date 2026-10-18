-- PICKUP: главная страница — популярные лиги, рейтинг прогнозистов по ROI,
-- команды и амплуа спортсменов для страницы матча.

-- ---------------------------------------------------------------------------
-- Популярные лиги на главной: порядок внутри вида спорта. Остальные турниры
-- остаются в базе, но на главной не показываются. Киберспорт отбирается по
-- названию турнира (см. src/lib/featured.ts).
alter table public.leagues add column featured_rank smallint;

update public.leagues l
   set featured_rank = v.rank
  from (values
    ('17', 1::smallint),  -- Англия: Премьер-лига
    ('35', 2::smallint),  -- Германия: Бундеслига
    ('8', 3::smallint),   -- Испания: Ла Лига (Примера)
    ('23', 4::smallint),  -- Италия: Серия А
    ('34', 5::smallint),  -- Франция: Лига 1
    ('203', 6::smallint), -- Россия: Премьер-лига
    ('234', 1::smallint), -- США: НХЛ
    ('268', 2::smallint), -- Россия: КХЛ
    ('132', 1::smallint), -- США: НБА
    ('1438', 2::smallint) -- Единая лига ВТБ
  ) as v(tid, rank)
 where l.external_ids ->> 'oddspapi' = v.tid;

-- ---------------------------------------------------------------------------
-- Команда, амплуа и номер спортсмена приходят из ростера лиги (задача фото).
-- Источник линий (OddsPapi) их не знает и при каждой загрузке передаёт null —
-- известные значения не затираются.
create or replace function private.keep_player_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.team_id := coalesce(new.team_id, old.team_id);
  new.position := coalesce(new.position, old.position);
  new.jersey_number := coalesce(new.jersey_number, old.jersey_number);
  return new;
end;
$$;

create trigger players_keep_profile
  before update on public.players
  for each row execute function private.keep_player_profile();

-- Кандидаты на поиск фото и профиля: команды матчей с id, чтобы привязать спортсмена.
drop function public.players_needing_photos(integer);
create function public.players_needing_photos(p_limit integer default 10)
returns table (
  player_id uuid,
  sport_id text,
  full_name text,
  league_codes text[],
  team_names text[],
  teams jsonb,
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
           array_agg(distinct m.home_team_id) || array_agg(distinct m.away_team_id) as team_ids
      from public.projections p
      join public.matches m on m.id = p.match_id
      join public.leagues l on l.id = m.league_id
     where m.starts_at > now() - interval '30 days'
     group by p.player_id
  )
  select pl.id, pl.sport_id, pl.full_name, r.league_codes,
         array(select distinct coalesce(t.name_en, t.name) from public.teams t where t.id = any (r.team_ids)),
         (select jsonb_agg(distinct jsonb_build_object('id', t.id, 'name', coalesce(t.name_en, t.name)))
            from public.teams t where t.id = any (r.team_ids)),
         pl.photo_url
    from recent r
    join public.players pl on pl.id = r.player_id
   where pl.photo_checked_at is null
      or (pl.photo_url is null and pl.photo_checked_at < now() - interval '7 days')
      or (pl.photo_url is not null and pl.photo_checked_at < now() - interval '14 days')
   order by (pl.photo_checked_at is null) desc, r.has_open desc, r.last_start desc
   limit greatest(p_limit, 0);
$$;

-- p_items: [{player_id, found, keep, photo_url, photo_source, external_player_id, photo_license,
--            photo_author, photo_license_url, photo_page_url, team_id, position, jersey_number}]
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
           team_id = coalesce(i.team_id, pl.team_id),
           position = coalesce(i.position, pl.position),
           jersey_number = coalesce(i.jersey_number, pl.jersey_number),
           photo_checked_at = now(),
           updated_at = now()
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(
        player_id uuid, found boolean, keep boolean, photo_url text, photo_source text, external_player_id text,
        photo_license text, photo_author text, photo_license_url text, photo_page_url text,
        team_id uuid, position text, jersey_number smallint)
     where pl.id = i.player_id
    returning 1
  )
  select count(*)::integer from updated;
$$;

revoke execute on function public.players_needing_photos(integer) from public, anon, authenticated;
grant execute on function public.players_needing_photos(integer) to service_role;

-- Спортсмены, найденные до появления профиля, проверяются заново (команда, амплуа).
update public.players set photo_checked_at = null where position is null and photo_checked_at is not null;

-- ---------------------------------------------------------------------------
-- Рейтинг прогнозистов: ROI = чистая прибыль / сумма ставок рассчитанных
-- прогнозов за текущий месяц (МСК). При равном ROI выше тот, у кого больше прибыль.
create or replace function public.get_roi_leaderboard(p_limit integer default 5)
returns table (
  rank bigint,
  user_id uuid,
  nickname text,
  avatar_url text,
  lineups_settled integer,
  profit bigint,
  staked bigint,
  roi numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with period as (
    select extract(year from now() at time zone 'Europe/Moscow')::smallint as y,
           extract(month from now() at time zone 'Europe/Moscow')::smallint as m
  ), ranked as (
    select s.user_id, s.lineups_settled, s.profit, s.staked,
           round(s.profit * 100.0 / s.staked, 1) as roi,
           row_number() over (order by s.profit::numeric / s.staked desc, s.profit desc, s.user_id) as rank
      from public.monthly_user_stats s, period
     where s.year = period.y and s.month = period.m and s.staked > 0
  )
  select r.rank, r.user_id, p.nickname, p.avatar_url, r.lineups_settled, r.profit, r.staked, r.roi
    from ranked r
    join public.profiles p on p.id = r.user_id
   order by r.rank
   limit least(greatest(p_limit, 1), 100);
$$;

-- Место текущего пользователя (null, если в этом месяце нет рассчитанных прогнозов).
create or replace function public.get_my_roi_rank()
returns table (
  rank bigint,
  lineups_settled integer,
  profit bigint,
  staked bigint,
  roi numeric,
  total_players bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with period as (
    select extract(year from now() at time zone 'Europe/Moscow')::smallint as y,
           extract(month from now() at time zone 'Europe/Moscow')::smallint as m
  ), ranked as (
    select s.user_id, s.lineups_settled, s.profit, s.staked,
           round(s.profit * 100.0 / s.staked, 1) as roi,
           row_number() over (order by s.profit::numeric / s.staked desc, s.profit desc, s.user_id) as rank,
           count(*) over () as total
      from public.monthly_user_stats s, period
     where s.year = period.y and s.month = period.m and s.staked > 0
  )
  select r.rank, r.lineups_settled, r.profit, r.staked, r.roi, r.total
    from ranked r
   where r.user_id = auth.uid();
$$;

revoke execute on function public.get_roi_leaderboard(integer) from public;
grant execute on function public.get_roi_leaderboard(integer) to anon, authenticated;
revoke execute on function public.get_my_roi_rank() from public, anon;
grant execute on function public.get_my_roi_rank() to authenticated;
