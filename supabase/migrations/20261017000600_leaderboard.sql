-- PICKUP: рейтинги и сводка профиля.
-- Место считается как 1 + число участников с бóльшим показателем
-- (стандартное «спортивное» ранжирование), что использует индексы и не требует
-- оконной функции по всей таблице.

-- Общий рейтинг по капиталу (баланс + резерв в активных прогнозах).
create or replace function public.get_overall_leaderboard(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  rank bigint,
  user_id uuid,
  nickname text,
  avatar_url text,
  capital bigint,
  profit bigint,
  lineups_total integer,
  lineups_settled integer,
  win_rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    1 + (select count(*) from public.wallets w2 where w2.capital > w.capital) as rank,
    p.id,
    p.nickname,
    p.avatar_url,
    w.capital,
    w.capital - w.funded_total as profit,
    coalesce(s.lineups_total, 0),
    coalesce(s.lineups_settled, 0),
    case when coalesce(s.lineups_settled, 0) = 0 then null
         else round(100.0 * s.lineups_won / s.lineups_settled, 1) end
  from public.wallets w
  join public.profiles p on p.id = w.user_id
  left join public.user_stats s on s.user_id = w.user_id
  where p_search is null or length(trim(p_search)) = 0
     or p.nickname ilike '%' || replace(replace(trim(p_search), '%', '\%'), '_', '\_') || '%'
  order by w.capital desc, w.user_id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create or replace function public.get_my_overall_rank()
returns table (rank bigint, capital bigint, profit bigint, total_players bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    1 + (select count(*) from public.wallets w2 where w2.capital > w.capital),
    w.capital,
    w.capital - w.funded_total,
    (select count(*) from public.wallets)
  from public.wallets w
  where w.user_id = auth.uid();
$$;

-- Месячный рейтинг: текущий месяц — «живые» данные, прошедшие — из архива.
-- Если архив за прошедший месяц ещё не сформирован, используются живые данные.
create or replace function public.get_monthly_leaderboard(
  p_year integer,
  p_month integer,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  rank bigint,
  user_id uuid,
  nickname text,
  avatar_url text,
  profit bigint,
  lineups_settled integer,
  lineups_won integer,
  is_archived boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_pattern text := '%' || replace(replace(coalesce(v_search, ''), '%', '\%'), '_', '\_') || '%';
  v_limit integer := least(greatest(p_limit, 1), 100);
  v_offset integer := greatest(p_offset, 0);
begin
  if exists (
    select 1 from public.leaderboard_snapshots
     where year = p_year and month = p_month
  ) then
    return query
      select ls.rank::bigint, ls.user_id, p.nickname, p.avatar_url, ls.profit,
             ls.lineups_settled, ls.lineups_won, true
        from public.leaderboard_snapshots ls
        join public.profiles p on p.id = ls.user_id
       where ls.year = p_year and ls.month = p_month
         and (v_search is null or p.nickname ilike v_pattern)
       order by ls.rank, ls.user_id
       limit v_limit offset v_offset;
    return;
  end if;

  return query
    select 1 + (
             select count(*) from public.monthly_user_stats m2
              where m2.year = p_year and m2.month = p_month and m2.profit > m.profit
           ),
           m.user_id, p.nickname, p.avatar_url, m.profit,
           m.lineups_settled, m.lineups_won, false
      from public.monthly_user_stats m
      join public.profiles p on p.id = m.user_id
     where m.year = p_year and m.month = p_month
       and (v_search is null or p.nickname ilike v_pattern)
     order by m.profit desc, m.user_id
     limit v_limit offset v_offset;
end;
$$;

create or replace function public.get_my_monthly_rank(p_year integer, p_month integer)
returns table (rank bigint, profit bigint, lineups_settled integer, total_players bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if exists (
    select 1 from public.leaderboard_snapshots where year = p_year and month = p_month
  ) then
    return query
      select ls.rank::bigint, ls.profit, ls.lineups_settled,
             (select count(*) from public.leaderboard_snapshots x
               where x.year = p_year and x.month = p_month)
        from public.leaderboard_snapshots ls
       where ls.year = p_year and ls.month = p_month and ls.user_id = auth.uid();
    return;
  end if;

  return query
    select 1 + (
             select count(*) from public.monthly_user_stats m2
              where m2.year = p_year and m2.month = p_month and m2.profit > m.profit
           ),
           m.profit, m.lineups_settled,
           (select count(*) from public.monthly_user_stats x
             where x.year = p_year and x.month = p_month)
      from public.monthly_user_stats m
     where m.year = p_year and m.month = p_month and m.user_id = auth.uid();
end;
$$;

-- Месяцы, за которые есть рейтинг (текущий всегда первым).
create or replace function public.get_leaderboard_periods()
returns table (year integer, month integer, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (select private.msk_month_start(now()) as d)
  select extract(year from d)::integer, extract(month from d)::integer, true from cur
  union
  select distinct ls.year::integer, ls.month::integer, false
    from public.leaderboard_snapshots ls, cur
   where make_date(ls.year, ls.month, 1) < cur.d
  union
  select distinct m.year::integer, m.month::integer, false
    from public.monthly_user_stats m, cur
   where make_date(m.year, m.month, 1) < cur.d
  order by 1 desc, 2 desc;
$$;

-- Фиксация архива за все завершённые месяцы, у которых ещё нет снимка.
create or replace function private.snapshot_monthly_leaderboards(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current date := private.msk_month_start(p_now);
  v_total integer := 0;
  v_rows integer;
  r record;
begin
  for r in
    select distinct m.year, m.month
      from public.monthly_user_stats m
     where make_date(m.year, m.month, 1) < v_current
       and not exists (
         select 1 from public.leaderboard_snapshots ls
          where ls.year = m.year and ls.month = m.month
       )
  loop
    insert into public.leaderboard_snapshots (
      year, month, rank, user_id, nickname, avatar_url, profit, lineups_settled, lineups_won
    )
    select m.year, m.month,
           rank() over (order by m.profit desc),
           m.user_id, p.nickname, p.avatar_url, m.profit, m.lineups_settled, m.lineups_won
      from public.monthly_user_stats m
      join public.profiles p on p.id = m.user_id
     where m.year = r.year and m.month = r.month
    on conflict (year, month, user_id) do nothing;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
  end loop;
  return v_total;
end;
$$;

-- Сводка профиля текущего пользователя — один запрос вместо нескольких.
create or replace function public.get_my_profile_summary()
returns table (
  user_id uuid,
  nickname text,
  avatar_url text,
  role public.user_role,
  created_at timestamptz,
  balance bigint,
  reserved bigint,
  capital bigint,
  profit bigint,
  overall_rank bigint,
  total_players bigint,
  lineups_total integer,
  lineups_settled integer,
  lineups_won integer,
  win_rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nickname, p.avatar_url, p.role, p.created_at,
         w.balance, w.reserved, w.capital, w.capital - w.funded_total,
         1 + (select count(*) from public.wallets w2 where w2.capital > w.capital),
         (select count(*) from public.wallets),
         coalesce(s.lineups_total, 0), coalesce(s.lineups_settled, 0), coalesce(s.lineups_won, 0),
         case when coalesce(s.lineups_settled, 0) = 0 then null
              else round(100.0 * s.lineups_won / s.lineups_settled, 1) end
    from public.profiles p
    join public.wallets w on w.user_id = p.id
    left join public.user_stats s on s.user_id = p.id
   where p.id = auth.uid();
$$;
