-- PICKUP: киберспорт — Dota 2 и Counter-Strike 2.
-- Турниры в киберспорте меняются постоянно, поэтому «лига» = вид спорта целиком:
-- external_ids.oddspapi_sport — sportId OddsPapi (16 — ESport Dota,
-- 17 — ESport Counter-Strike, проверено по GET /v4/sports).
-- Показатели считаются за весь матч (серию), как в рынках OddsPapi с period=result.

insert into public.sports (id, name, sort_order) values
  ('dota', 'Dota 2', 4),
  ('cs', 'Counter-Strike 2', 5)
on conflict (id) do nothing;

insert into public.leagues (sport_id, code, name, short_name, country, external_ids, sort_order) values
  ('dota', 'DOTA2', 'Dota 2 — профессиональные турниры', 'Dota 2', 'Киберспорт', '{"oddspapi_sport": "16"}', 7),
  ('cs', 'CS2', 'Counter-Strike 2 — профессиональные турниры', 'CS2', 'Киберспорт', '{"oddspapi_sport": "17"}', 8)
on conflict (code) do nothing;

insert into public.markets (sport_id, code, name, short_name, components, sort_order) values
  ('dota', 'kills', 'Убийства за матч', 'Убийства', array['kills'], 1),
  ('cs', 'kills', 'Убийства за матч', 'Убийства', array['kills'], 1),
  ('cs', 'headshots', 'Хедшоты за матч', 'Хедшоты', array['headshots'], 2)
on conflict (sport_id, code) do nothing;
