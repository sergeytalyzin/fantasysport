-- PICKUP: подтверждение купона и расчёт (settlement).

-- ---------------------------------------------------------------------------
-- Подтверждение купона.
-- p_selections: [{"projection_id": uuid, "direction": "OVER"|"UNDER", "line": 3.5}, ...]
-- line — значение, которое видел пользователь; при расхождении купон отклоняется.
-- p_expected_multiplier — множитель, который видел пользователь.
-- ---------------------------------------------------------------------------
create or replace function public.create_lineup(
  p_play_type public.play_type,
  p_stake bigint,
  p_selections jsonb,
  p_expected_multiplier numeric,
  p_idempotency_key text
)
returns public.lineups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_lineup public.lineups;
  v_count integer;
  v_min_picks integer := coalesce(private.setting_bigint('min_picks'), 2);
  v_max_picks integer := coalesce(private.setting_bigint('max_picks'), 6);
  v_flex_min integer := coalesce(private.setting_bigint('flex_min_picks'), 3);
  v_min_stake bigint := coalesce(private.setting_bigint('min_stake'), 10000);
  v_max_stake bigint := coalesce(private.setting_bigint('max_stake'), 10000000);
  v_multiplier numeric;
  v_snapshot jsonb;
  v_bad record;
  v_found integer;
  v_ids uuid[];
  v_dirs public.pick_direction[];
  v_lines numeric[];
begin
  if v_user_id is null then
    perform private.raise_error('AUTH_REQUIRED', 'Войдите, чтобы сделать прогноз');
  end if;

  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100 then
    perform private.raise_error('IDEMPOTENCY_KEY_REQUIRED', 'Некорректный ключ запроса');
  end if;

  -- Повторная отправка того же купона возвращает уже созданный купон.
  select * into v_lineup from public.lineups
   where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    return v_lineup;
  end if;

  if p_selections is null or jsonb_typeof(p_selections) <> 'array' then
    perform private.raise_error('INVALID_SELECTIONS', 'Некорректный состав купона');
  end if;

  v_count := jsonb_array_length(p_selections);
  if v_count < v_min_picks or v_count > v_max_picks then
    perform private.raise_error(
      'INVALID_PICKS_COUNT',
      format('В купоне должно быть от %s до %s прогнозов', v_min_picks, v_max_picks)
    );
  end if;
  if p_play_type = 'FLEX' and v_count < v_flex_min then
    perform private.raise_error(
      'FLEX_MIN_PICKS',
      format('Flex Play доступен от %s прогнозов', v_flex_min)
    );
  end if;

  if p_stake is null or p_stake < v_min_stake or p_stake > v_max_stake or p_stake % 100 <> 0 then
    perform private.raise_error(
      'INVALID_STAKE',
      format('Сумма должна быть от %s до %s ₽ (целое число рублей)', v_min_stake / 100, v_max_stake / 100)
    );
  end if;

  begin
    select array_agg((t.elem ->> 'projection_id')::uuid order by t.ord),
           array_agg((t.elem ->> 'direction')::public.pick_direction order by t.ord),
           array_agg((t.elem ->> 'line')::numeric order by t.ord)
      into v_ids, v_dirs, v_lines
      from jsonb_array_elements(p_selections) with ordinality as t(elem, ord);
  exception when others then
    perform private.raise_error('INVALID_SELECTIONS', 'Некорректный состав купона');
  end;

  if array_position(v_ids, null) is not null
     or array_position(v_dirs, null) is not null
     or array_position(v_lines, null) is not null then
    perform private.raise_error('INVALID_SELECTIONS', 'Некорректный состав купона');
  end if;

  if (select count(distinct x) from unnest(v_ids) x) <> v_count then
    perform private.raise_error(
      'DUPLICATE_PROJECTION',
      'Одну линию можно выбрать только один раз — противоположные исходы запрещены'
    );
  end if;

  -- Блокируем линии от изменения до конца транзакции и проверяем актуальность.
  perform 1
     from public.projections p
    where p.id = any (v_ids)
    for share;

  select count(*) into v_found
    from unnest(v_ids, v_dirs, v_lines) with ordinality as i(projection_id, direction, line, ord)
    join public.projections p on p.id = i.projection_id;
  if v_found <> v_count then
    perform private.raise_error('PROJECTION_NOT_FOUND', 'Одна из линий больше недоступна');
  end if;

  select pl.full_name, p.line, i.line as expected_line, p.status, m.status as match_status, m.starts_at
    into v_bad
    from unnest(v_ids, v_dirs, v_lines) with ordinality as i(projection_id, direction, line, ord)
    join public.projections p on p.id = i.projection_id
    join public.matches m on m.id = p.match_id
    join public.players pl on pl.id = p.player_id
   where p.status <> 'OPEN'
      or m.status <> 'SCHEDULED'
      or m.starts_at <= now()
      or p.line <> i.line
   order by i.ord
   limit 1;
  if found then
    if v_bad.line <> v_bad.expected_line then
      perform private.raise_error(
        'LINE_CHANGED',
        format('Линия на %s изменилась: %s → %s. Обновите купон', v_bad.full_name, v_bad.expected_line, v_bad.line)
      );
    end if;
    perform private.raise_error(
      'PROJECTION_CLOSED',
      format('Приём прогнозов на %s закрыт', v_bad.full_name)
    );
  end if;

  if (
    select count(distinct p.player_id)
      from unnest(v_ids, v_dirs, v_lines) with ordinality as i(projection_id, direction, line, ord)
      join public.projections p on p.id = i.projection_id
  ) <> v_count then
    perform private.raise_error('DUPLICATE_PLAYER', 'Один спортсмен может быть в купоне только один раз');
  end if;

  select r.multiplier into v_multiplier
    from public.payout_rules r
   where r.play_type = p_play_type
     and r.picks_count = v_count
     and r.correct_count = v_count
     and r.is_active;
  if v_multiplier is null or v_multiplier <= 0 then
    perform private.raise_error('PAYOUT_RULE_MISSING', 'Для такого купона нет действующего множителя');
  end if;
  if p_expected_multiplier is distinct from v_multiplier then
    perform private.raise_error(
      'MULTIPLIER_CHANGED',
      format('Множитель изменился: теперь ×%s. Проверьте купон', trim_scale(v_multiplier))
    );
  end if;

  -- Снимок всех правил, нужных для расчёта, включая понижение числа выборов
  -- из-за аннулированных линий.
  select jsonb_agg(
           jsonb_build_object(
             'picks_count', r.picks_count,
             'correct_count', r.correct_count,
             'multiplier', r.multiplier
           ) order by r.picks_count, r.correct_count
         )
    into v_snapshot
    from public.payout_rules r
   where r.play_type = p_play_type
     and r.picks_count <= v_count
     and r.is_active;

  insert into public.lineups (
    user_id, play_type, picks_count, stake, multiplier, potential_payout,
    payout_snapshot, idempotency_key
  ) values (
    v_user_id, p_play_type, v_count, p_stake, v_multiplier,
    floor(p_stake * v_multiplier)::bigint, v_snapshot, p_idempotency_key
  )
  returning * into v_lineup;

  insert into public.lineup_selections (
    lineup_id, projection_id, match_id, player_id, market_id, direction, line,
    stat_components, player_name, team_abbr, opponent_abbr, market_name,
    league_code, match_starts_at
  )
  select v_lineup.id, p.id, p.match_id, p.player_id, p.market_id, i.direction, p.line,
         mk.components, pl.full_name, t.abbr,
         case when pl.team_id = m.home_team_id then away.abbr else home.abbr end,
         mk.name, lg.code, m.starts_at
    from unnest(v_ids, v_dirs, v_lines) with ordinality as i(projection_id, direction, line, ord)
    join public.projections p on p.id = i.projection_id
    join public.matches m on m.id = p.match_id
    join public.leagues lg on lg.id = m.league_id
    join public.teams home on home.id = m.home_team_id
    join public.teams away on away.id = m.away_team_id
    join public.players pl on pl.id = p.player_id
    left join public.teams t on t.id = pl.team_id
    join public.markets mk on mk.id = p.market_id
   order by i.ord;

  -- Списание суммы и резервирование. Недостаточный баланс откатывает весь купон.
  perform private.wallet_apply(
    v_user_id, 'PICK_STAKE', -p_stake, p_stake,
    'stake:' || v_lineup.id::text, v_lineup.id,
    format('%s Play, %s выбора', initcap(p_play_type::text), v_count)
  );

  update public.user_stats
     set lineups_total = lineups_total + 1,
         total_staked = total_staked + p_stake,
         updated_at = now()
   where user_id = v_user_id;

  return v_lineup;
end;
$$;

-- ---------------------------------------------------------------------------
-- Результат одного выбора по подтверждённой статистике.
-- ---------------------------------------------------------------------------
create or replace function private.evaluate_selection(
  p_stats jsonb,
  p_did_play boolean,
  p_components text[],
  p_direction public.pick_direction,
  p_line numeric,
  out result public.selection_result,
  out actual_value numeric,
  out reason text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_sum numeric := 0;
begin
  if p_stats is null or p_did_play is not true then
    result := 'VOID';
    reason := 'Спортсмен не принял участия в матче';
    return;
  end if;

  foreach v_key in array p_components loop
    if not (p_stats ? v_key) or jsonb_typeof(p_stats -> v_key) <> 'number' then
      result := 'VOID';
      reason := 'Нет статистики по показателю';
      return;
    end if;
    v_sum := v_sum + (p_stats ->> v_key)::numeric;
  end loop;

  actual_value := v_sum;
  if v_sum = p_line then
    result := 'PUSH';
    reason := 'Показатель равен линии';
  elsif (v_sum > p_line) = (p_direction = 'OVER') then
    result := 'WIN';
  else
    result := 'LOSS';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Расчёт купона после того, как все выборы получили результат.
-- Аннулированные выборы и «пуши» уменьшают число выборов (как при понижении купона).
-- ---------------------------------------------------------------------------
create or replace function private.settle_lineup(p_lineup_id uuid)
returns public.lineup_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineup public.lineups;
  v_active integer;
  v_wins integer;
  v_multiplier numeric := 0;
  v_payout bigint := 0;
  v_status public.lineup_status;
  v_note text;
  v_period date := private.msk_month_start(now());
begin
  select * into v_lineup from public.lineups where id = p_lineup_id for update;
  if not found or v_lineup.status <> 'PENDING' then
    return v_lineup.status;
  end if;

  if exists (
    select 1 from public.lineup_selections
     where lineup_id = p_lineup_id and result = 'PENDING'
  ) then
    return 'PENDING';
  end if;

  select count(*) filter (where result in ('WIN', 'LOSS')),
         count(*) filter (where result = 'WIN')
    into v_active, v_wins
    from public.lineup_selections
   where lineup_id = p_lineup_id;

  if v_active < 2 then
    -- Купон рассыпался: возвращаем сумму целиком.
    perform private.wallet_apply(
      v_lineup.user_id, 'PICK_REFUND', v_lineup.stake, -v_lineup.stake,
      'refund:' || p_lineup_id::text, p_lineup_id,
      'Возврат: в купоне осталось меньше 2 действительных прогнозов'
    );
    update public.lineups
       set status = 'VOID', payout = v_lineup.stake, applied_multiplier = 1,
           settled_at = now(),
           settlement_note = 'Меньше 2 действительных прогнозов — сумма возвращена'
     where id = p_lineup_id;
    return 'VOID';
  end if;

  select (rule ->> 'multiplier')::numeric into v_multiplier
    from jsonb_array_elements(v_lineup.payout_snapshot) rule
   where (rule ->> 'picks_count')::integer = v_active
     and (rule ->> 'correct_count')::integer = v_wins;
  v_multiplier := coalesce(v_multiplier, 0);

  if v_lineup.play_type = 'POWER' and v_wins < v_active then
    v_multiplier := 0;
  end if;

  v_payout := floor(v_lineup.stake * v_multiplier)::bigint;
  v_status := case
    when v_payout = 0 then 'LOST'
    when v_wins = v_active then 'WON'
    else 'PARTIALLY_WON'
  end::public.lineup_status;
  v_note := format('Угадано %s из %s, множитель ×%s', v_wins, v_active, trim_scale(v_multiplier));
  if v_active < v_lineup.picks_count then
    v_note := v_note || format(' (аннулировано выборов: %s)', v_lineup.picks_count - v_active);
  end if;

  if v_payout > 0 then
    perform private.wallet_apply(
      v_lineup.user_id, 'PICK_WIN', v_payout, -v_lineup.stake,
      'win:' || p_lineup_id::text, p_lineup_id,
      format('Выигрыш ×%s', trim_scale(v_multiplier))
    );
  else
    perform private.wallet_release_reserve(v_lineup.user_id, v_lineup.stake);
  end if;

  update public.lineups
     set status = v_status, payout = v_payout, applied_multiplier = v_multiplier,
         settled_at = now(), settlement_note = v_note
   where id = p_lineup_id;

  update public.user_stats
     set lineups_settled = lineups_settled + 1,
         lineups_won = lineups_won + case when v_status in ('WON', 'PARTIALLY_WON') then 1 else 0 end,
         total_payout = total_payout + v_payout,
         updated_at = now()
   where user_id = v_lineup.user_id;

  insert into public.monthly_user_stats as s (user_id, year, month, lineups_settled, lineups_won, staked, payout)
  values (
    v_lineup.user_id,
    extract(year from v_period)::smallint,
    extract(month from v_period)::smallint,
    1,
    case when v_status in ('WON', 'PARTIALLY_WON') then 1 else 0 end,
    v_lineup.stake,
    v_payout
  )
  on conflict (user_id, year, month) do update
     set lineups_settled = s.lineups_settled + 1,
         lineups_won = s.lineups_won + excluded.lineups_won,
         staked = s.staked + excluded.staked,
         payout = s.payout + excluded.payout,
         updated_at = now();

  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Расчёт всех выборов матча. Выполняется только для отменённого матча
-- или завершённого матча с подтверждённой статистикой. Повторный вызов безопасен:
-- обрабатываются только выборы PENDING и купоны PENDING.
-- ---------------------------------------------------------------------------
create or replace function private.settle_match(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_lineup_id uuid;
  v_settled integer := 0;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    perform private.raise_error('MATCH_NOT_FOUND', 'Матч не найден');
  end if;

  if v_match.status = 'CANCELLED' then
    update public.lineup_selections
       set result = 'VOID', result_reason = 'Матч отменён', settled_at = now()
     where match_id = p_match_id and result = 'PENDING';
    update public.projections set status = 'VOID'
     where match_id = p_match_id and status <> 'VOID';
  elsif v_match.status = 'FINISHED' and v_match.results_confirmed_at is not null then
    update public.lineup_selections s
       set result = e.result,
           actual_value = e.actual_value,
           result_reason = e.reason,
           settled_at = now()
      from public.lineup_selections s2
      left join public.player_statistics ps
        on ps.match_id = s2.match_id and ps.player_id = s2.player_id
      cross join lateral private.evaluate_selection(
        ps.stats, ps.did_play, s2.stat_components, s2.direction, s2.line
      ) e
     where s.id = s2.id
       and s2.match_id = p_match_id
       and s2.result = 'PENDING';
    update public.projections set status = 'SETTLED'
     where match_id = p_match_id and status in ('OPEN', 'SUSPENDED');
  else
    return 0;
  end if;

  for v_lineup_id in
    select distinct s.lineup_id
      from public.lineup_selections s
      join public.lineups l on l.id = s.lineup_id
     where s.match_id = p_match_id and l.status = 'PENDING'
     order by s.lineup_id
  loop
    if private.settle_lineup(v_lineup_id) <> 'PENDING' then
      v_settled := v_settled + 1;
    end if;
  end loop;

  update public.matches set settled_at = coalesce(settled_at, now()) where id = p_match_id;
  return v_settled;
end;
$$;

-- Плановый расчёт всех готовых матчей (Cron и Edge Function).
create or replace function private.settle_ready_matches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_total integer := 0;
begin
  for v_match_id in
    select m.id
      from public.matches m
     where (m.status = 'CANCELLED'
            or (m.status = 'FINISHED' and m.results_confirmed_at is not null))
       and exists (
         select 1 from public.lineup_selections s
          where s.match_id = m.id and s.result = 'PENDING'
       )
     order by m.starts_at
  loop
    v_total := v_total + private.settle_match(v_match_id);
  end loop;
  return v_total;
end;
$$;

-- Ручной возврат купона администратором (или системой).
create or replace function private.refund_lineup(p_lineup_id uuid, p_reason text)
returns public.lineups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineup public.lineups;
begin
  select * into v_lineup from public.lineups where id = p_lineup_id for update;
  if not found then
    perform private.raise_error('LINEUP_NOT_FOUND', 'Купон не найден');
  end if;
  if v_lineup.status <> 'PENDING' then
    perform private.raise_error('LINEUP_ALREADY_SETTLED', 'Купон уже рассчитан');
  end if;

  perform private.wallet_apply(
    v_lineup.user_id, 'PICK_REFUND', v_lineup.stake, -v_lineup.stake,
    'refund:' || p_lineup_id::text, p_lineup_id,
    coalesce('Возврат: ' || p_reason, 'Возврат')
  );

  update public.lineup_selections
     set result = 'VOID', result_reason = coalesce(p_reason, 'Возврат'), settled_at = now()
   where lineup_id = p_lineup_id and result = 'PENDING';

  update public.lineups
     set status = 'REFUNDED', payout = stake, applied_multiplier = 1,
         settled_at = now(), settlement_note = p_reason
   where id = p_lineup_id
  returning * into v_lineup;

  return v_lineup;
end;
$$;
