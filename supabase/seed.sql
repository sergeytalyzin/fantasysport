-- PICKUP: данные ТОЛЬКО для локальной разработки (supabase db reset).
-- Справочники (виды спорта, лиги, рынки, множители, настройки) находятся в миграциях.
-- Реальные матчи и линии загружает Edge Function sports-sync (OddsPapi).
--
-- Тестовые аккаунты (пароль у всех: pickup-demo-2026):
--   admin@pickup.local   — администратор
--   player1@pickup.local — игрок
--   player2@pickup.local — игрок
-- НЕ применяйте этот файл к рабочему проекту.

do $seed$
declare
  r record;
begin
  for r in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@pickup.local', 'Admin'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'player1@pickup.local', 'Ovechkin_Fan'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'player2@pickup.local', 'Kucherov86')
    ) as t(id, email, nickname)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
      extensions.crypt('pickup-demo-2026', extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object('nickname', r.nickname), now(), now(), '', '', '', ''
    )
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), r.id, r.id::text,
      jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict do nothing;
  end loop;

  update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-000000000001';
end;
$seed$;
