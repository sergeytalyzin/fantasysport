-- PICKUP: официальные видеотрансляции на странице матча.
-- Администратор указывает ссылку на официальный бесплатный стрим (YouTube, Twitch,
-- VK Видео, Rutube) — на сайте показывается встроенный плеер площадки.
-- Видео не хранится и не проксируется: воспроизведение идёт с площадки правообладателя.

alter table public.matches add column stream_url text;

-- p_url = null или пустая строка — убрать трансляцию.
create or replace function public.admin_set_match_stream(p_match_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := nullif(btrim(p_url), '');
  v_old text;
begin
  perform private.require_admin();
  select stream_url into v_old from public.matches where id = p_match_id for update;
  if not found then
    perform private.raise_error('MATCH_NOT_FOUND', 'Матч не найден');
  end if;
  -- Тот же список площадок, что и в src/lib/stream-embed.ts.
  if v_url is not null and v_url !~* '^https://((www|m)\.)?(youtube\.com|youtu\.be|twitch\.tv|player\.twitch\.tv|vkvideo\.ru|vk\.com|vk\.ru|rutube\.ru)/' then
    perform private.raise_error('STREAM_URL_INVALID', 'Поддерживаются только ссылки YouTube, Twitch, VK Видео и Rutube');
  end if;

  update public.matches set stream_url = v_url where id = p_match_id;
  perform private.audit('match.set_stream', 'match', p_match_id::text, jsonb_build_object('old', v_old, 'new', v_url));
end;
$$;

revoke execute on function public.admin_set_match_stream(uuid, text) from public, anon;
grant execute on function public.admin_set_match_stream(uuid, text) to authenticated;
