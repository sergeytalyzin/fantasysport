-- PICKUP: снимок купона для спортсменов без известной команды.
-- Раньше соперником ошибочно записывались хозяева; теперь — «хозяева vs гости».

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
         mk.components, pl.full_name,
         -- Команда спортсмена может быть неизвестна (OddsPapi): тогда снимок — сам матч.
         coalesce(t.abbr, home.abbr),
         case when pl.team_id is null or pl.team_id = m.home_team_id then away.abbr else home.abbr end,
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
