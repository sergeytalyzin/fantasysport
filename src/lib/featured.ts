// Главная показывает только популярные виды спорта и лиги.
// Лиги футбола, хоккея и баскетбола отмечены в leagues.featured_rank (порядок внутри вида спорта),
// киберспортивные турниры отбираются по названию — они появляются и заканчиваются каждую неделю.
import type { SportId } from "@/types/domain";

/** Виды спорта на главной — строго в этом порядке. Новый вид спорта добавляется сюда. */
export const HOME_SPORTS: SportId[] = ["football", "hockey", "basketball", "dota", "cs"];

export const ESPORTS_SPORTS: SportId[] = ["dota", "cs"];

/** Турниры первого эшелона Dota 2 и CS2 (тот же список, что и для линий в sports-sync, плюс PARI Universe). */
export const FEATURED_ESPORTS_PATTERN =
  "IEM|Intel Extreme|BLAST|ESL Pro League|PGL|Major|The International|DreamLeague|Riyadh|Esports World Cup|BetBoom|FISSURE|Perfect World|StarLadder|Thunderpick World|ESL One|PARI|Universe";
