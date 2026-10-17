// ТЕСТОВЫЕ ДАННЫЕ Demo Provider. Средние значения статистики условные и служат
// только для генерации демо-линий и демо-результатов. Составы КХЛ и РПЛ
// вымышлены; для остальных лиг используются известные спортсмены, но их
// клубная принадлежность и показатели не претендуют на актуальность.

import type { LeagueCode, SportId } from "../types.ts";

export interface DemoPlayerSeed {
  id: string;
  name: string;
  position: string;
  number: number;
  /** Средние значения по ключам статистики вида спорта. */
  means: Record<string, number>;
  /** Коды рынков, на которые выставляются линии. */
  markets: string[];
}

export interface DemoTeamSeed {
  id: string;
  name: string;
  shortName: string;
  abbr: string;
  color: string;
  players: DemoPlayerSeed[];
}

export interface DemoLeagueSeed {
  code: LeagueCode;
  sportId: SportId;
  name: string;
  /** Время начала матчей по Москве: [часы, минуты]. */
  kickoffs: [number, number][];
  durationMinutes: number;
  teams: DemoTeamSeed[];
}

const skater = (
  id: string,
  name: string,
  number: number,
  [goals, assists, shots]: [number, number, number],
  markets: string[] = ["shots_on_goal", "points"],
  position = "Нападающий",
): DemoPlayerSeed => ({
  id,
  name,
  position,
  number,
  means: { goals, assists, shots_on_goal: shots, saves: 0 },
  markets,
});

const goalie = (id: string, name: string, number: number, saves: number): DemoPlayerSeed => ({
  id,
  name,
  position: "Вратарь",
  number,
  means: { goals: 0, assists: 0.02, shots_on_goal: 0, saves },
  markets: ["saves"],
});

const footballer = (
  id: string,
  name: string,
  position: string,
  number: number,
  [goals, shots, onTarget, passes]: [number, number, number, number],
  markets: string[],
): DemoPlayerSeed => ({
  id,
  name,
  position,
  number,
  means: { goals, shots, shots_on_target: onTarget, passes },
  markets,
});

const hooper = (
  id: string,
  name: string,
  position: string,
  number: number,
  [points, rebounds, assists, threes]: [number, number, number, number],
  markets: string[],
): DemoPlayerSeed => ({
  id,
  name,
  position,
  number,
  means: { points, rebounds, assists, threes_made: threes },
  markets,
});

export const DEMO_LEAGUES: DemoLeagueSeed[] = [
  {
    code: "KHL",
    sportId: "hockey",
    name: "КХЛ",
    kickoffs: [[17, 0], [19, 30]],
    durationMinutes: 150,
    teams: [
      {
        id: "khl-ska", name: "СКА", shortName: "СКА", abbr: "СКА", color: "#1D4ED8",
        players: [
          skater("khl-ska-1", "Артём Соколов", 17, [0.42, 0.5, 3.2]),
          skater("khl-ska-2", "Денис Карпов", 91, [0.3, 0.62, 2.4], ["assists", "points"]),
          skater("khl-ska-3", "Илья Бородин", 44, [0.12, 0.35, 1.9], ["shots_on_goal"], "Защитник"),
          goalie("khl-ska-g", "Михаил Лебедев", 30, 25.5),
        ],
      },
      {
        id: "khl-cska", name: "ЦСКА", shortName: "ЦСКА", abbr: "ЦСК", color: "#B91C1C",
        players: [
          skater("khl-cska-1", "Никита Воронов", 9, [0.45, 0.4, 3.5]),
          skater("khl-cska-2", "Павел Ершов", 23, [0.25, 0.55, 2.1], ["assists", "points"]),
          skater("khl-cska-3", "Глеб Мельников", 7, [0.1, 0.4, 2.2], ["shots_on_goal"], "Защитник"),
          goalie("khl-cska-g", "Алексей Широков", 1, 24.5),
        ],
      },
      {
        id: "khl-akb", name: "Ак Барс", shortName: "Ак Барс", abbr: "АКБ", color: "#15803D",
        players: [
          skater("khl-akb-1", "Тимур Галиев", 13, [0.38, 0.48, 3.0]),
          skater("khl-akb-2", "Руслан Хайруллин", 71, [0.33, 0.52, 2.7]),
          skater("khl-akb-3", "Егор Савельев", 55, [0.09, 0.3, 1.6], ["shots_on_goal"], "Защитник"),
          goalie("khl-akb-g", "Даниил Захаров", 31, 26.5),
        ],
      },
      {
        id: "khl-mmg", name: "Металлург Мг", shortName: "Металлург", abbr: "ММГ", color: "#C2410C",
        players: [
          skater("khl-mmg-1", "Кирилл Уральцев", 88, [0.48, 0.58, 3.6]),
          skater("khl-mmg-2", "Сергей Дронов", 19, [0.28, 0.44, 2.3], ["assists", "shots_on_goal"]),
          skater("khl-mmg-3", "Роман Пестов", 4, [0.11, 0.33, 1.8], ["shots_on_goal"], "Защитник"),
          goalie("khl-mmg-g", "Василий Ковалёв", 35, 25.5),
        ],
      },
    ],
  },
  {
    code: "NHL",
    sportId: "hockey",
    name: "НХЛ",
    kickoffs: [[2, 0], [4, 30]],
    durationMinutes: 150,
    teams: [
      {
        id: "nhl-wsh", name: "Вашингтон Кэпиталз", shortName: "Вашингтон", abbr: "WSH", color: "#C8102E",
        players: [
          skater("nhl-wsh-1", "Александр Овечкин", 8, [0.55, 0.38, 3.8], ["shots_on_goal", "goals", "points"]),
          skater("nhl-wsh-2", "Дилан Строум", 17, [0.25, 0.6, 1.9], ["assists", "points"]),
          skater("nhl-wsh-3", "Том Уилсон", 43, [0.38, 0.35, 2.6]),
          goalie("nhl-wsh-g", "Логан Томпсон", 48, 26.5),
        ],
      },
      {
        id: "nhl-tbl", name: "Тампа-Бэй Лайтнинг", shortName: "Тампа", abbr: "TBL", color: "#002868",
        players: [
          skater("nhl-tbl-1", "Никита Кучеров", 86, [0.45, 0.95, 3.4], ["points", "assists", "shots_on_goal"]),
          skater("nhl-tbl-2", "Брэйден Пойнт", 21, [0.48, 0.45, 2.7]),
          skater("nhl-tbl-3", "Брэндон Хейгел", 38, [0.4, 0.4, 2.5]),
          goalie("nhl-tbl-g", "Андрей Василевский", 88, 27.5),
        ],
      },
      {
        id: "nhl-edm", name: "Эдмонтон Ойлерз", shortName: "Эдмонтон", abbr: "EDM", color: "#FF4C00",
        players: [
          skater("nhl-edm-1", "Коннор Макдэвид", 97, [0.55, 1.1, 3.5], ["points", "assists", "shots_on_goal"]),
          skater("nhl-edm-2", "Леон Драйзайтль", 29, [0.62, 0.7, 3.1], ["goals", "points", "shots_on_goal"]),
          skater("nhl-edm-3", "Зак Хайман", 18, [0.4, 0.35, 2.4]),
          goalie("nhl-edm-g", "Стюарт Скиннер", 74, 25.5),
        ],
      },
      {
        id: "nhl-nyr", name: "Нью-Йорк Рейнджерс", shortName: "Рейнджерс", abbr: "NYR", color: "#0038A8",
        players: [
          skater("nhl-nyr-1", "Артемий Панарин", 10, [0.42, 0.75, 3.2], ["points", "assists", "shots_on_goal"]),
          skater("nhl-nyr-2", "Мика Зибанеджад", 93, [0.35, 0.5, 2.8]),
          skater("nhl-nyr-3", "Алексис Лафреньер", 13, [0.33, 0.35, 2.3]),
          goalie("nhl-nyr-g", "Игорь Шестёркин", 31, 28.5),
        ],
      },
    ],
  },
  {
    code: "RPL",
    sportId: "football",
    name: "РПЛ",
    kickoffs: [[16, 30], [19, 0]],
    durationMinutes: 115,
    teams: [
      {
        id: "rpl-zen", name: "Зенит", shortName: "Зенит", abbr: "ЗЕН", color: "#0EA5E9",
        players: [
          footballer("rpl-zen-1", "Матвей Громов", "Нападающий", 9, [0.55, 3.4, 1.6, 18], ["shots", "shots_on_target"]),
          footballer("rpl-zen-2", "Андрей Шилов", "Вингер", 11, [0.3, 2.6, 1.1, 28], ["shots", "shots_on_target"]),
          footballer("rpl-zen-3", "Олег Белов", "Полузащитник", 8, [0.12, 1.3, 0.5, 62], ["passes"]),
          footballer("rpl-zen-4", "Ярослав Титов", "Защитник", 4, [0.05, 0.6, 0.2, 71], ["passes"]),
        ],
      },
      {
        id: "rpl-spa", name: "Спартак", shortName: "Спартак", abbr: "СПА", color: "#DC2626",
        players: [
          footballer("rpl-spa-1", "Даниил Рябов", "Нападающий", 10, [0.48, 3.1, 1.4, 21], ["shots", "shots_on_target"]),
          footballer("rpl-spa-2", "Максим Зуев", "Вингер", 7, [0.28, 2.4, 1.0, 26], ["shots", "shots_on_target"]),
          footballer("rpl-spa-3", "Владислав Котов", "Полузащитник", 6, [0.1, 1.2, 0.4, 58], ["passes"]),
          footballer("rpl-spa-4", "Арсений Фомин", "Защитник", 3, [0.04, 0.5, 0.2, 65], ["passes"]),
        ],
      },
      {
        id: "rpl-csk", name: "ЦСКА", shortName: "ЦСКА", abbr: "ЦСК", color: "#1E3A8A",
        players: [
          footballer("rpl-csk-1", "Станислав Носов", "Нападающий", 19, [0.42, 2.9, 1.3, 17], ["shots", "shots_on_target"]),
          footballer("rpl-csk-2", "Эмиль Ахметов", "Вингер", 17, [0.25, 2.2, 0.9, 25], ["shots", "shots_on_target"]),
          footballer("rpl-csk-3", "Никита Орлов", "Полузащитник", 5, [0.09, 1.1, 0.4, 55], ["passes"]),
          footballer("rpl-csk-4", "Игорь Ветров", "Защитник", 2, [0.04, 0.5, 0.1, 63], ["passes"]),
        ],
      },
      {
        id: "rpl-krd", name: "Краснодар", shortName: "Краснодар", abbr: "КРД", color: "#16A34A",
        players: [
          footballer("rpl-krd-1", "Георгий Лаптев", "Нападающий", 33, [0.5, 3.3, 1.5, 19], ["shots", "shots_on_target"]),
          footballer("rpl-krd-2", "Тимофей Ильин", "Вингер", 21, [0.3, 2.5, 1.1, 27], ["shots", "shots_on_target"]),
          footballer("rpl-krd-3", "Семён Кравец", "Полузащитник", 14, [0.11, 1.4, 0.5, 60], ["passes"]),
          footballer("rpl-krd-4", "Лев Морозов", "Защитник", 15, [0.05, 0.6, 0.2, 68], ["passes"]),
        ],
      },
    ],
  },
  {
    code: "EPL",
    sportId: "football",
    name: "АПЛ",
    kickoffs: [[17, 0], [19, 30]],
    durationMinutes: 115,
    teams: [
      {
        id: "epl-mci", name: "Манчестер Сити", shortName: "Ман Сити", abbr: "MCI", color: "#6CABDD",
        players: [
          footballer("epl-mci-1", "Эрлинг Холанд", "Нападающий", 9, [0.85, 3.6, 1.9, 14], ["shots", "shots_on_target", "goals"]),
          footballer("epl-mci-2", "Фил Фоден", "Полузащитник", 47, [0.35, 2.4, 1.0, 42], ["shots", "passes"]),
          footballer("epl-mci-3", "Родри", "Полузащитник", 16, [0.1, 1.2, 0.4, 88], ["passes"]),
          footballer("epl-mci-4", "Бернарду Силва", "Полузащитник", 20, [0.15, 1.3, 0.5, 64], ["passes"]),
        ],
      },
      {
        id: "epl-liv", name: "Ливерпуль", shortName: "Ливерпуль", abbr: "LIV", color: "#C8102E",
        players: [
          footballer("epl-liv-1", "Мохамед Салах", "Вингер", 11, [0.62, 3.4, 1.5, 32], ["shots", "shots_on_target", "goals"]),
          footballer("epl-liv-2", "Флориан Вирц", "Полузащитник", 7, [0.3, 2.3, 0.9, 45], ["shots", "passes"]),
          footballer("epl-liv-3", "Коди Гакпо", "Вингер", 18, [0.4, 2.7, 1.1, 24], ["shots", "shots_on_target"]),
          footballer("epl-liv-4", "Алексис Макаллистер", "Полузащитник", 10, [0.12, 1.5, 0.5, 66], ["passes"]),
        ],
      },
      {
        id: "epl-ars", name: "Арсенал", shortName: "Арсенал", abbr: "ARS", color: "#EF0107",
        players: [
          footballer("epl-ars-1", "Букайо Сака", "Вингер", 7, [0.45, 3.0, 1.2, 33], ["shots", "shots_on_target"]),
          footballer("epl-ars-2", "Мартин Эдегор", "Полузащитник", 8, [0.25, 2.1, 0.8, 58], ["passes", "shots"]),
          footballer("epl-ars-3", "Деклан Райс", "Полузащитник", 41, [0.15, 1.4, 0.5, 61], ["passes"]),
          footballer("epl-ars-4", "Виктор Дьёкереш", "Нападающий", 14, [0.6, 3.2, 1.5, 15], ["shots", "shots_on_target", "goals"]),
        ],
      },
      {
        id: "epl-che", name: "Челси", shortName: "Челси", abbr: "CHE", color: "#034694",
        players: [
          footballer("epl-che-1", "Коул Палмер", "Полузащитник", 10, [0.55, 3.3, 1.3, 40], ["shots", "shots_on_target"]),
          footballer("epl-che-2", "Энцо Фернандес", "Полузащитник", 8, [0.18, 1.7, 0.6, 63], ["passes"]),
          footballer("epl-che-3", "Жоао Педро", "Нападающий", 20, [0.45, 2.8, 1.2, 20], ["shots", "shots_on_target"]),
          footballer("epl-che-4", "Мойзес Кайседо", "Полузащитник", 25, [0.06, 0.8, 0.3, 67], ["passes"]),
        ],
      },
    ],
  },
  {
    code: "UCL",
    sportId: "football",
    name: "Лига чемпионов",
    kickoffs: [[20, 45], [23, 0]],
    durationMinutes: 115,
    teams: [
      {
        id: "ucl-rma", name: "Реал Мадрид", shortName: "Реал", abbr: "RMA", color: "#FEBE10",
        players: [
          footballer("ucl-rma-1", "Килиан Мбаппе", "Нападающий", 10, [0.8, 4.2, 2.0, 22], ["shots", "shots_on_target", "goals"]),
          footballer("ucl-rma-2", "Винисиус Жуниор", "Вингер", 7, [0.45, 3.1, 1.3, 30], ["shots", "shots_on_target"]),
          footballer("ucl-rma-3", "Джуд Беллингем", "Полузащитник", 5, [0.35, 2.2, 0.9, 44], ["shots", "passes"]),
          footballer("ucl-rma-4", "Федерико Вальверде", "Полузащитник", 8, [0.15, 1.8, 0.6, 52], ["passes"]),
        ],
      },
      {
        id: "ucl-bar", name: "Барселона", shortName: "Барселона", abbr: "BAR", color: "#A50044",
        players: [
          footballer("ucl-bar-1", "Ламин Ямаль", "Вингер", 10, [0.45, 3.4, 1.4, 36], ["shots", "shots_on_target"]),
          footballer("ucl-bar-2", "Роберт Левандовски", "Нападающий", 9, [0.7, 3.5, 1.8, 16], ["shots", "shots_on_target", "goals"]),
          footballer("ucl-bar-3", "Рафинья", "Вингер", 11, [0.5, 3.0, 1.3, 31], ["shots", "shots_on_target"]),
          footballer("ucl-bar-4", "Педри", "Полузащитник", 8, [0.15, 1.5, 0.5, 72], ["passes"]),
        ],
      },
      {
        id: "ucl-bay", name: "Бавария", shortName: "Бавария", abbr: "BAY", color: "#DC052D",
        players: [
          footballer("ucl-bay-1", "Гарри Кейн", "Нападающий", 9, [0.85, 3.8, 1.9, 24], ["shots", "shots_on_target", "goals"]),
          footballer("ucl-bay-2", "Джамал Мусиала", "Полузащитник", 42, [0.4, 2.6, 1.0, 38], ["shots", "shots_on_target"]),
          footballer("ucl-bay-3", "Майкл Олисе", "Вингер", 17, [0.4, 2.7, 1.1, 34], ["shots", "shots_on_target"]),
          footballer("ucl-bay-4", "Джошуа Киммих", "Полузащитник", 6, [0.08, 1.1, 0.4, 85], ["passes"]),
        ],
      },
      {
        id: "ucl-psg", name: "ПСЖ", shortName: "ПСЖ", abbr: "PSG", color: "#004170",
        players: [
          footballer("ucl-psg-1", "Усман Дембеле", "Нападающий", 10, [0.6, 3.6, 1.6, 27], ["shots", "shots_on_target", "goals"]),
          footballer("ucl-psg-2", "Хвича Кварацхелия", "Вингер", 7, [0.4, 3.0, 1.2, 29], ["shots", "shots_on_target"]),
          footballer("ucl-psg-3", "Витинья", "Полузащитник", 17, [0.12, 1.6, 0.5, 92], ["passes"]),
          footballer("ucl-psg-4", "Дезире Дуэ", "Вингер", 14, [0.35, 2.4, 0.9, 30], ["shots", "shots_on_target"]),
        ],
      },
    ],
  },
  {
    code: "NBA",
    sportId: "basketball",
    name: "НБА",
    kickoffs: [[3, 0], [5, 30]],
    durationMinutes: 150,
    teams: [
      {
        id: "nba-lal", name: "Лос-Анджелес Лейкерс", shortName: "Лейкерс", abbr: "LAL", color: "#552583",
        players: [
          hooper("nba-lal-1", "Леброн Джеймс", "Форвард", 23, [25.5, 7.8, 8.2, 2.1], ["points", "pts_reb_ast", "assists"]),
          hooper("nba-lal-2", "Лука Дончич", "Защитник", 77, [29.5, 8.4, 8.0, 3.4], ["points", "threes", "pts_reb_ast"]),
          hooper("nba-lal-3", "Остин Ривз", "Защитник", 15, [20.2, 4.4, 5.5, 2.6], ["points", "pts_ast"]),
          hooper("nba-lal-4", "Деандре Эйтон", "Центровой", 5, [14.1, 10.2, 1.6, 0], ["rebounds", "pts_reb"]),
        ],
      },
      {
        id: "nba-den", name: "Денвер Наггетс", shortName: "Денвер", abbr: "DEN", color: "#0E2240",
        players: [
          hooper("nba-den-1", "Никола Йокич", "Центровой", 15, [27.8, 12.6, 9.8, 1.6], ["points", "rebounds", "pts_reb_ast"]),
          hooper("nba-den-2", "Джамал Мюррей", "Защитник", 27, [21.4, 4.1, 6.0, 2.7], ["points", "threes"]),
          hooper("nba-den-3", "Аарон Гордон", "Форвард", 32, [14.0, 5.9, 3.1, 1.0], ["points", "pts_reb"]),
          hooper("nba-den-4", "Кристиан Браун", "Защитник", 0, [11.5, 5.0, 2.5, 1.3], ["points", "rebounds"]),
        ],
      },
      {
        id: "nba-okc", name: "Оклахома-Сити Тандер", shortName: "Оклахома", abbr: "OKC", color: "#007AC1",
        players: [
          hooper("nba-okc-1", "Шай Гилджес-Александер", "Защитник", 2, [31.8, 5.2, 6.3, 2.0], ["points", "pts_ast", "assists"]),
          hooper("nba-okc-2", "Джейлен Уильямс", "Форвард", 8, [20.6, 5.4, 5.0, 1.7], ["points", "pts_reb_ast"]),
          hooper("nba-okc-3", "Чет Холмгрен", "Центровой", 7, [16.5, 8.2, 2.1, 1.6], ["rebounds", "pts_reb"]),
          hooper("nba-okc-4", "Лу Дорт", "Защитник", 5, [10.2, 4.0, 1.6, 2.4], ["threes", "points"]),
        ],
      },
      {
        id: "nba-bos", name: "Бостон Селтикс", shortName: "Бостон", abbr: "BOS", color: "#007A33",
        players: [
          hooper("nba-bos-1", "Джейсон Тейтум", "Форвард", 0, [26.8, 8.7, 5.9, 3.3], ["points", "rebounds", "pts_reb_ast"]),
          hooper("nba-bos-2", "Джейлен Браун", "Защитник", 7, [23.4, 5.8, 4.4, 2.1], ["points", "pts_reb"]),
          hooper("nba-bos-3", "Деррик Уайт", "Защитник", 9, [16.1, 4.4, 4.7, 3.2], ["threes", "points"]),
          hooper("nba-bos-4", "Пейтон Причард", "Защитник", 11, [14.2, 3.8, 3.5, 3.0], ["threes", "pts_ast"]),
        ],
      },
    ],
  },
];

/** Ключи статистики, которые Demo Provider генерирует для вида спорта. */
export const SPORT_STAT_KEYS: Record<SportId, string[]> = {
  hockey: ["goals", "assists", "shots_on_goal", "saves"],
  football: ["goals", "shots", "shots_on_target", "passes"],
  basketball: ["points", "rebounds", "assists", "threes_made"],
};
