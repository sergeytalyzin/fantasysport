// Амплуа спортсменов: группа, подпись, порядок на странице матча и цвет карточки.
// Источники пишут амплуа по-разному: НХЛ — C/L/R/D/G, футбольные API — Attacker/F/FW и т. п.
import type { SportId } from "@/types/domain";

export interface PositionGroup {
  key: string;
  label: string;
  order: number;
  color: string;
}

const FORWARD: PositionGroup = { key: "fw", label: "Нападающий", order: 1, color: "#ff5c7a" };
const MIDFIELDER: PositionGroup = { key: "mf", label: "Полузащитник", order: 2, color: "#7c8cff" };
const DEFENDER: PositionGroup = { key: "df", label: "Защитник", order: 3, color: "#3df5a7" };
const GOALKEEPER: PositionGroup = { key: "gk", label: "Вратарь", order: 4, color: "#ffc83d" };

const BASKETBALL_GUARD: PositionGroup = { key: "g", label: "Защитник", order: 1, color: "#3df5a7" };
const BASKETBALL_FORWARD: PositionGroup = { key: "f", label: "Форвард", order: 2, color: "#ff5c7a" };
const BASKETBALL_CENTER: PositionGroup = { key: "c", label: "Центровой", order: 3, color: "#7c8cff" };

const UNKNOWN: PositionGroup = { key: "other", label: "Игрок", order: 9, color: "#8a94a6" };

const norm = (p: string) => p.trim().toLowerCase().replace(/[^a-zа-я]/g, "");

/** Группа амплуа по виду спорта и записи источника; неизвестное — «Игрок». */
export function positionGroup(sport: SportId, position: string | null | undefined): PositionGroup {
  if (!position) return UNKNOWN;
  const p = norm(position);
  if (sport === "hockey") {
    if (["c", "l", "r", "lw", "rw", "f", "forward", "center", "centre", "leftwing", "rightwing", "нападающий"].includes(p)) return FORWARD;
    if (["d", "defense", "defence", "defenseman", "defenceman", "защитник"].includes(p)) return DEFENDER;
    if (["g", "goalie", "goalkeeper", "goaltender", "вратарь"].includes(p)) return GOALKEEPER;
    return UNKNOWN;
  }
  if (sport === "football") {
    if (["f", "fw", "st", "cf", "a", "attacker", "forward", "striker", "winger", "нападающий"].includes(p)) return FORWARD;
    if (["m", "mf", "cm", "dm", "am", "midfielder", "midfield", "полузащитник"].includes(p)) return MIDFIELDER;
    if (["d", "df", "cb", "lb", "rb", "defender", "defence", "defense", "защитник"].includes(p)) return DEFENDER;
    if (["g", "gk", "goalkeeper", "keeper", "вратарь"].includes(p)) return GOALKEEPER;
    return UNKNOWN;
  }
  if (sport === "basketball") {
    if (["g", "pg", "sg", "guard", "pointguard", "shootingguard", "защитник"].includes(p)) return BASKETBALL_GUARD;
    if (["f", "sf", "pf", "forward", "smallforward", "powerforward", "gf", "fg", "форвард"].includes(p)) return BASKETBALL_FORWARD;
    if (["c", "center", "centre", "fc", "cf", "центровой"].includes(p)) return BASKETBALL_CENTER;
    return UNKNOWN;
  }
  return UNKNOWN;
}
