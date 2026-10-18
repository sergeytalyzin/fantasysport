-- PICKUP: подписи популярных лиг на главной («Страна · Лига»), как в макете.
-- Названия из OddsPapi обновляются при каждой загрузке расписания, поэтому
-- подпись хранится отдельно и не затирается.

alter table public.leagues
  add column display_country text,
  add column display_name text;

update public.leagues l
   set display_country = v.country, display_name = v.name
  from (values
    ('17', 'Англия', 'Премьер-лига'),
    ('35', 'Германия', 'Бундеслига'),
    ('8', 'Испания', 'Примера'),
    ('23', 'Италия', 'Серия А'),
    ('34', 'Франция', 'Первая лига'),
    ('203', 'Россия', 'Премьер-лига'),
    ('234', 'США', 'НХЛ'),
    ('268', 'Россия', 'КХЛ'),
    ('132', 'США', 'НБА'),
    ('1438', 'Россия', 'Единая лига ВТБ')
  ) as v(tid, country, name)
 where l.external_ids ->> 'oddspapi' = v.tid;
