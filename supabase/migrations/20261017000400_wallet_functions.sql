-- PICKUP: операции с кошельком. Баланс меняется ТОЛЬКО через private.wallet_apply.

-- Атомарное и идемпотентное применение операции.
-- p_amount — изменение доступного баланса, p_reserved_delta — изменение резерва.
-- Порядок важен: сначала блокируем строку кошелька, затем проверяем ключ
-- идемпотентности — так параллельный повтор увидит уже закоммиченную операцию.
create or replace function private.wallet_apply(
  p_user_id uuid,
  p_type public.wallet_tx_type,
  p_amount bigint,
  p_reserved_delta bigint,
  p_idempotency_key text,
  p_lineup_id uuid default null,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
begin
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then
    perform private.raise_error('IDEMPOTENCY_KEY_REQUIRED', 'Не указан ключ идемпотентности');
  end if;

  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if not found then
    perform private.raise_error('WALLET_NOT_FOUND', 'Кошелёк не найден');
  end if;

  select * into v_tx from public.wallet_transactions where idempotency_key = p_idempotency_key;
  if found then
    return v_tx;
  end if;

  if v_wallet.balance + p_amount < 0 then
    perform private.raise_error('INSUFFICIENT_FUNDS', 'Недостаточно виртуальных рублей на балансе');
  end if;
  if v_wallet.reserved + p_reserved_delta < 0 then
    perform private.raise_error('RESERVE_UNDERFLOW', 'Некорректная операция с резервом');
  end if;

  update public.wallets
     set balance = balance + p_amount,
         reserved = reserved + p_reserved_delta,
         funded_total = funded_total + case
           when p_type in ('INITIAL_BONUS', 'MONTHLY_BONUS', 'ADMIN_ADJUSTMENT') then p_amount
           else 0
         end,
         updated_at = now()
   where user_id = p_user_id
  returning * into v_wallet;

  insert into public.wallet_transactions (
    user_id, type, amount, balance_after, reserved_after, lineup_id,
    idempotency_key, description, metadata, created_by
  ) values (
    p_user_id, p_type, p_amount, v_wallet.balance, v_wallet.reserved, p_lineup_id,
    p_idempotency_key, p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by
  )
  returning * into v_tx;

  return v_tx;
end;
$$;

-- Снятие резерва без движения баланса (проигранный купон).
create or replace function private.wallet_release_reserve(p_user_id uuid, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wallets
     set reserved = reserved - p_amount,
         updated_at = now()
   where user_id = p_user_id;
  if not found then
    perform private.raise_error('WALLET_NOT_FOUND', 'Кошелёк не найден');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Регистрация: профиль, кошелёк, стартовый бонус
-- ---------------------------------------------------------------------------
create or replace function private.pick_nickname(p_requested text, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := nullif(trim(p_requested), '');
  v_candidate text;
begin
  if v_base is null or v_base !~ '^[A-Za-zА-Яа-яЁё0-9_.-]{3,24}$' then
    v_base := 'player_' || substr(replace(p_user_id::text, '-', ''), 1, 6);
  end if;
  v_candidate := v_base;
  while exists (select 1 from public.profiles where lower(nickname) = lower(v_candidate)) loop
    v_candidate := left(v_base, 19) || '_' || substr(md5(random()::text), 1, 4);
  end loop;
  return v_candidate;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount bigint := coalesce(private.setting_bigint('initial_bonus_amount'), 10000000);
  v_created_at timestamptz := coalesce(new.created_at, now());
  v_period date := private.msk_month_start(v_created_at);
  v_tx public.wallet_transactions;
begin
  insert into public.profiles (id, nickname, created_at)
  values (
    new.id,
    private.pick_nickname(new.raw_user_meta_data ->> 'nickname', new.id),
    v_created_at
  )
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (new.id) on conflict do nothing;
  insert into public.user_stats (user_id) values (new.id) on conflict do nothing;

  v_tx := private.wallet_apply(
    new.id, 'INITIAL_BONUS', v_amount, 0,
    'initial_bonus:' || new.id::text,
    null, 'Стартовый бонус'
  );

  -- Месяц регистрации считается закрытым: ежемесячный бонус за него не начисляется.
  insert into public.monthly_bonus_grants (user_id, year, month, kind, amount, transaction_id)
  values (
    new.id,
    extract(year from v_period)::smallint,
    extract(month from v_period)::smallint,
    'REGISTRATION', v_amount, v_tx.id
  )
  on conflict (user_id, year, month) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Ежемесячный бонус. Начисляет все пропущенные месяцы с месяца, следующего
-- за месяцем регистрации, по текущий месяц (МСК) включительно. Повторный
-- запуск безопасен: уникальный ключ (user_id, year, month) + ключ идемпотентности.
-- ---------------------------------------------------------------------------
create or replace function private.grant_monthly_bonuses(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current date := private.msk_month_start(p_now);
  v_amount bigint := coalesce(private.setting_bigint('monthly_bonus_amount'), 10000000);
  v_enabled boolean := coalesce(private.setting_bool('monthly_bonus_enabled'), true);
  v_count integer := 0;
  v_grant_id bigint;
  v_tx public.wallet_transactions;
  r record;
begin
  if not v_enabled or v_amount <= 0 then
    return 0;
  end if;

  for r in
    select p.id as user_id, gs::date as period
      from public.profiles p
      cross join lateral generate_series(
        (private.msk_month_start(p.created_at) + interval '1 month')::date,
        v_current,
        interval '1 month'
      ) gs
     where not exists (
       select 1 from public.monthly_bonus_grants g
        where g.user_id = p.id
          and g.year = extract(year from gs)
          and g.month = extract(month from gs)
     )
     order by gs, p.id
  loop
    insert into public.monthly_bonus_grants (user_id, year, month, kind, amount)
    values (
      r.user_id,
      extract(year from r.period)::smallint,
      extract(month from r.period)::smallint,
      'MONTHLY', v_amount
    )
    on conflict (user_id, year, month) do nothing
    returning id into v_grant_id;

    continue when v_grant_id is null;

    v_tx := private.wallet_apply(
      r.user_id, 'MONTHLY_BONUS', v_amount, 0,
      'monthly_bonus:' || r.user_id::text || ':' || to_char(r.period, 'YYYY-MM'),
      null,
      'Ежемесячный бонус за ' || to_char(r.period, 'MM.YYYY'),
      jsonb_build_object('period', to_char(r.period, 'YYYY-MM'))
    );

    update public.monthly_bonus_grants set transaction_id = v_tx.id where id = v_grant_id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
