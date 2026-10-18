-- PICKUP: фото футболистов из API-Football по ID игрока (media.api-sports.io).
-- Источник линий футбола — тот же API-Football, поэтому игрок определяется точно.

alter table public.players drop constraint players_photo_source_check;
alter table public.players add constraint players_photo_source_check
  check (photo_source in ('nhl', 'nba', 'apifootball', 'sportmonks', 'wikimedia'));

-- Все футболисты с линиями PICKUP проверяются заново: фото API-Football в приоритете.
update public.players
   set photo_checked_at = null
 where sport_id = 'football' and source = 'pickup';
