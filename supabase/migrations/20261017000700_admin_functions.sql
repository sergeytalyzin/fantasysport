-- PICKUP: административные RPC. Каждая функция проверяет роль в БД
-- и журналирует изменения в admin_audit_logs.

create or replace function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'Доступ только для администраторов', hint = 'FORBIDDEN';
  end if;
end;
$$;

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_today', (select count(*) from public.profiles where created_at > now() - interval '24 hours'),
    'capital_total', (select coalesce(sum(capital), 0) from public.wallets),
    'reserved_total', (select coalesce(sum(reserved), 0) from public.wallets),
    'lineups_pending', (select count(*) from public.lineups where status = 'PENDING'),
    'lineups_today', (select count(*) from public.lineups where created_at > now() - interval '24 hours'),
    'projections_open', (
      select count(*) from public.projections p join public.matches m on m.id = p.match_id
       where p.status = 'OPEN' and m.status = 'SCHEDULED' and m.starts_at > now()
    ),
    'matches_awaiting_results', (
      select count(*) from public.matches
       where status in ('LIVE', 'FINISHED') and results_confirmed_at is null
         and starts_at < now()
    ),
    'sync_errors_24h', (
      select count(*) from public.sync_runs
       where status = 'ERROR' and started_at > now() - interval '24 hours'
    ),
    'last_sync_at', (select max(finished_at) from public.sync_runs where status = 'SUCCESS')
  );
end;
$$;

create or replace function public.admin_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  nickname text,
  role public.user_role,
  created_at timestamptz,
  balance bigint,
  reserved bigint,
  capital bigint,
  funded_total bigint,
  lineups_total integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform private.require_admin();
  return query
    select p.id, u.email::text, p.nickname, p.role, p.created_at,
           w.balance, w.reserved, w.capital, w.funded_total,
           coalesce(s.lineups_total, 0)
      from public.profiles p
      join auth.users u on u.id = p.id
      join public.wallets w on w.user_id = p.id
      left join public.user_stats s on s.user_id = p.id
     where v_search is null
        or p.nickname ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
     order by p.created_at desc
     limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.admin_adjust_balance(
  p_user_id uuid,
  p_amount bigint,
  p_reason text
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.wallet_transactions;
begin
  perform private.require_admin();
  if p_amount is null or p_amount = 0 then
    perform private.raise_error('INVALID_AMOUNT', 'Сумма корректировки не может быть нулевой');
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    perform private.raise_error('REASON_REQUIRED', 'Укажите причину корректировки');
  end if;

  v_tx := private.wallet_apply(
    p_user_id, 'ADMIN_ADJUSTMENT', p_amount, 0,
    'admin_adjustment:' || gen_random_uuid()::text,
    null, 'Корректировка администратором: ' || trim(p_reason),
    jsonb_build_object('reason', trim(p_reason)), auth.uid()
  );

  perform private.audit(
    'wallet.adjust', 'wallet', p_user_id::text,
    jsonb_build_object('amount', p_amount, 'reason', trim(p_reason), 'transaction_id', v_tx.id)
  );
  return v_tx;
end;
$$;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_user_id = auth.uid() and p_role <> 'admin' then
    perform private.raise_error('SELF_DEMOTE', 'Нельзя снять права администратора с самого себя');
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  perform private.audit('user.set_role', 'profile', p_user_id::text, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
begin
  perform private.require_admin();
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then
    perform private.raise_error('SETTING_NOT_FOUND', 'Неизвестная настройка');
  end if;
  if jsonb_typeof(v_old) <> jsonb_typeof(p_value) then
    perform private.raise_error('SETTING_TYPE', 'Неверный тип значения настройки');
  end if;
  if jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric < 0 then
    perform private.raise_error('SETTING_NEGATIVE', 'Значение не может быть отрицательным');
  end if;
  update public.app_settings
     set value = p_value, updated_at = now(), updated_by = auth.uid()
   where key = p_key;
  perform private.audit('setting.update', 'app_setting', p_key,
    jsonb_build_object('old', v_old, 'new', p_value));
end;
$$;

create or replace function public.admin_upsert_payout_rule(
  p_play_type public.play_type,
  p_picks_count smallint,
  p_correct_count smallint,
  p_multiplier numeric,
  p_is_active boolean default true
)
returns public.payout_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.payout_rules;
begin
  perform private.require_admin();
  insert into public.payout_rules (play_type, picks_count, correct_count, multiplier, is_active)
  values (p_play_type, p_picks_count, p_correct_count, p_multiplier, p_is_active)
  on conflict (play_type, picks_count, correct_count) do update
     set multiplier = excluded.multiplier, is_active = excluded.is_active
  returning * into v_rule;
  perform private.audit('payout_rule.upsert', 'payout_rule', v_rule.id::text, to_jsonb(v_rule));
  return v_rule;
end;
$$;

create or replace function public.admin_update_projection(
  p_projection_id uuid,
  p_line numeric,
  p_status public.projection_status
)
returns public.projections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.projections;
  v_new public.projections;
begin
  perform private.require_admin();
  select * into v_old from public.projections where id = p_projection_id for update;
  if not found then
    perform private.raise_error('PROJECTION_NOT_FOUND', 'Линия не найдена');
  end if;
  if v_old.status in ('SETTLED', 'VOID') then
    perform private.raise_error('PROJECTION_FINAL', 'Линия уже рассчитана');
  end if;
  if p_status not in ('OPEN', 'SUSPENDED') then
    perform private.raise_error('PROJECTION_STATUS', 'Допустимые статусы: OPEN, SUSPENDED');
  end if;

  update public.projections
     set line = p_line,
         status = p_status,
         source = case when line <> p_line then 'manual' else source end,
         line_updated_at = case when line <> p_line then now() else line_updated_at end
   where id = p_projection_id
  returning * into v_new;

  perform private.audit('projection.update', 'projection', p_projection_id::text,
    jsonb_build_object('old_line', v_old.line, 'new_line', p_line,
                       'old_status', v_old.status, 'new_status', p_status));
  return v_new;
end;
$$;

create or replace function public.admin_create_projection(
  p_match_id uuid,
  p_player_id uuid,
  p_market_id uuid,
  p_line numeric
)
returns public.projections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.projections;
begin
  perform private.require_admin();
  insert into public.projections (match_id, player_id, market_id, line, source)
  values (p_match_id, p_player_id, p_market_id, p_line, 'manual')
  returning * into v_row;
  perform private.audit('projection.create', 'projection', v_row.id::text, to_jsonb(v_row));
  return v_row;
end;
$$;

create or replace function public.admin_set_match_status(
  p_match_id uuid,
  p_status public.match_status,
  p_home_score smallint default null,
  p_away_score smallint default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  perform private.require_admin();
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    perform private.raise_error('MATCH_NOT_FOUND', 'Матч не найден');
  end if;
  if v_match.results_confirmed_at is not null or v_match.status = 'CANCELLED' then
    perform private.raise_error('MATCH_FINAL', 'Результаты матча уже зафиксированы');
  end if;

  update public.matches
     set status = p_status,
         home_score = coalesce(p_home_score, home_score),
         away_score = coalesce(p_away_score, away_score)
   where id = p_match_id;

  perform private.audit('match.set_status', 'match', p_match_id::text,
    jsonb_build_object('old', v_match.status, 'new', p_status,
                       'home_score', p_home_score, 'away_score', p_away_score));

  if p_status = 'CANCELLED' then
    return private.settle_match(p_match_id);
  end if;
  return 0;
end;
$$;

create or replace function public.admin_upsert_player_stats(
  p_match_id uuid,
  p_player_id uuid,
  p_stats jsonb,
  p_did_play boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if exists (
    select 1 from public.matches where id = p_match_id and results_confirmed_at is not null
  ) then
    perform private.raise_error('MATCH_FINAL', 'Статистика матча уже подтверждена');
  end if;
  insert into public.player_statistics (match_id, player_id, stats, did_play, source)
  values (p_match_id, p_player_id, coalesce(p_stats, '{}'::jsonb), p_did_play, 'manual')
  on conflict (match_id, player_id) do update
     set stats = excluded.stats, did_play = excluded.did_play, source = 'manual';
  perform private.audit('stats.upsert', 'match', p_match_id::text,
    jsonb_build_object('player_id', p_player_id, 'stats', p_stats, 'did_play', p_did_play));
end;
$$;

-- Подтверждение статистики завершённого матча и немедленный расчёт.
create or replace function public.admin_confirm_match_results(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.matches
     set results_confirmed_at = now()
   where id = p_match_id and status = 'FINISHED' and results_confirmed_at is null;
  if not found then
    perform private.raise_error('MATCH_NOT_READY', 'Подтвердить можно только завершённый матч без подтверждения');
  end if;
  perform private.audit('match.confirm_results', 'match', p_match_id::text);
  return private.settle_match(p_match_id);
end;
$$;

create or replace function public.admin_settle_ready_matches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_admin();
  v_count := private.settle_ready_matches();
  perform private.audit('settlement.run', 'system', null, jsonb_build_object('settled', v_count));
  return v_count;
end;
$$;

create or replace function public.admin_refund_lineup(p_lineup_id uuid, p_reason text)
returns public.lineups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineup public.lineups;
begin
  perform private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then
    perform private.raise_error('REASON_REQUIRED', 'Укажите причину возврата');
  end if;
  v_lineup := private.refund_lineup(p_lineup_id, trim(p_reason));
  perform private.audit('lineup.refund', 'lineup', p_lineup_id::text,
    jsonb_build_object('reason', trim(p_reason), 'stake', v_lineup.stake));
  return v_lineup;
end;
$$;

create or replace function public.admin_run_monthly_bonuses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_admin();
  v_count := private.grant_monthly_bonuses();
  perform private.audit('bonus.monthly_run', 'system', null, jsonb_build_object('granted', v_count));
  return v_count;
end;
$$;
