-- PICKUP: фото спортсменов без лишних перепроверок.
-- Раньше найденные фото перепроверялись раз в 14 дней. Фото меняется по сути только
-- при переходе в другой клуб (у НХЛ в адресе фото — сезон и команда), поэтому повторный
-- поиск запускается при смене команды игрока, а не по календарю.

drop function public.players_needing_photos(integer);
create function public.players_needing_photos(p_limit integer default 10)
returns table (
  player_id uuid,
  sport_id text,
  full_name text,
  league_codes text[],
  team_names text[],
  teams jsonb,
  external_id text,
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
         pl.external_id,
         pl.photo_url
    from recent r
    join public.players pl on pl.id = r.player_id
   -- Найденное фото не перепроверяется: заново — только при смене команды (триггер ниже).
   -- Не найденное — повторная попытка раз в 30 дней.
   where pl.photo_checked_at is null
      or (pl.photo_url is null and pl.photo_checked_at < now() - interval '30 days')
   order by (pl.photo_checked_at is null) desc, r.has_open desc, r.last_start desc
   limit greatest(p_limit, 0);
$$;

revoke execute on function public.players_needing_photos(integer) from public, anon, authenticated;
grant execute on function public.players_needing_photos(integer) to service_role;

-- Смена команды — фото ищется заново при ближайшем запуске задачи.
create or replace function private.recheck_photo_on_team_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_id is distinct from old.team_id and old.team_id is not null and new.team_id is not null then
    new.photo_checked_at := null;
  end if;
  return new;
end;
$$;

create trigger players_recheck_photo
  before update of team_id on public.players
  for each row execute function private.recheck_photo_on_team_change();
