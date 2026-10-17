-- PICKUP: справочные данные, без которых платформа не работает.
-- Находятся в миграции (а не в seed.sql), чтобы попадать и в облачный проект.

insert into public.app_settings (key, value, description) values
  ('initial_bonus_amount', '10000000', 'Стартовый бонус, копейки (100 000 ₽)'),
  ('monthly_bonus_amount', '10000000', 'Ежемесячный бонус, копейки (100 000 ₽)'),
  ('monthly_bonus_enabled', 'true', 'Начислять ежемесячный бонус'),
  ('min_stake', '10000', 'Минимальная сумма купона, копейки (100 ₽)'),
  ('max_stake', '10000000', 'Максимальная сумма купона, копейки (100 000 ₽)'),
  ('min_picks', '2', 'Минимум выборов в купоне'),
  ('max_picks', '6', 'Максимум выборов в купоне'),
  ('flex_min_picks', '3', 'Минимум выборов для Flex Play')
on conflict (key) do nothing;

insert into public.sports (id, name, sort_order) values
  ('hockey', 'Хоккей', 1),
  ('football', 'Футбол', 2),
  ('basketball', 'Баскетбол', 3)
on conflict (id) do nothing;

insert into public.leagues (sport_id, code, name, short_name, country, sort_order) values
  ('hockey', 'KHL', 'Континентальная хоккейная лига', 'КХЛ', 'Россия', 1),
  ('hockey', 'NHL', 'Национальная хоккейная лига', 'НХЛ', 'США/Канада', 2),
  ('football', 'RPL', 'Российская Премьер-Лига', 'РПЛ', 'Россия', 3),
  ('football', 'EPL', 'Английская Премьер-лига', 'АПЛ', 'Англия', 4),
  ('football', 'UCL', 'Лига чемпионов УЕФА', 'ЛЧ', 'Европа', 5),
  ('basketball', 'NBA', 'Национальная баскетбольная ассоциация', 'НБА', 'США', 6)
on conflict (code) do nothing;

insert into public.markets (sport_id, code, name, short_name, components, sort_order) values
  ('hockey', 'goals', 'Голы', 'Голы', array['goals'], 1),
  ('hockey', 'assists', 'Передачи', 'Пас', array['assists'], 2),
  ('hockey', 'points', 'Очки (гол + пас)', 'Очки', array['goals', 'assists'], 3),
  ('hockey', 'shots_on_goal', 'Броски в створ', 'Броски', array['shots_on_goal'], 4),
  ('hockey', 'saves', 'Сейвы', 'Сейвы', array['saves'], 5),
  ('football', 'goals', 'Голы', 'Голы', array['goals'], 1),
  ('football', 'shots', 'Удары', 'Удары', array['shots'], 2),
  ('football', 'shots_on_target', 'Удары в створ', 'В створ', array['shots_on_target'], 3),
  ('football', 'passes', 'Передачи', 'Пасы', array['passes'], 4),
  ('basketball', 'points', 'Очки', 'Очки', array['points'], 1),
  ('basketball', 'rebounds', 'Подборы', 'Подборы', array['rebounds'], 2),
  ('basketball', 'assists', 'Передачи', 'Пасы', array['assists'], 3),
  ('basketball', 'threes', 'Трёхочковые', '3-очк.', array['threes_made'], 4),
  ('basketball', 'pts_reb_ast', 'Очки + Подборы + Передачи', 'О+П+П', array['points', 'rebounds', 'assists'], 5),
  ('basketball', 'pts_reb', 'Очки + Подборы', 'О+Подб', array['points', 'rebounds'], 6),
  ('basketball', 'pts_ast', 'Очки + Передачи', 'О+Пас', array['points', 'assists'], 7)
on conflict (sport_id, code) do nothing;

-- Power Play: все выборы должны сыграть.
insert into public.payout_rules (play_type, picks_count, correct_count, multiplier) values
  ('POWER', 2, 2, 3),
  ('POWER', 3, 3, 5),
  ('POWER', 4, 4, 10),
  ('POWER', 5, 5, 20),
  ('POWER', 6, 6, 37.5),
-- Flex Play: частичные выигрыши. Строка 2/2 используется только при понижении
-- купона из-за аннулированных выборов (создать Flex из 2 выборов нельзя).
  ('FLEX', 2, 2, 3),
  ('FLEX', 3, 3, 3),
  ('FLEX', 3, 2, 1),
  ('FLEX', 4, 4, 6),
  ('FLEX', 4, 3, 1.5),
  ('FLEX', 5, 5, 10),
  ('FLEX', 5, 4, 2),
  ('FLEX', 5, 3, 0.4),
  ('FLEX', 6, 6, 25),
  ('FLEX', 6, 5, 2),
  ('FLEX', 6, 4, 0.4)
on conflict (play_type, picks_count, correct_count) do nothing;
