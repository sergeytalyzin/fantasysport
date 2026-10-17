import { describe, expect, it } from "vitest";
import {
  currentMskPeriod,
  formatKickoff,
  formatKickoffShort,
  formatMatchDay,
  formatCountdown,
  formatLine,
  formatMultiplier,
  formatRub,
  formatRubCompact,
  nextMonthStartLabel,
  plural,
} from "./format";

// Intl в ru-RU разделяет разряды неразрывным пробелом.
const norm = (s: string) => s.replace(/ | /g, " ");

describe("format", () => {
  it("formatRub", () => {
    expect(norm(formatRub(10_000_000))).toBe("100 000 ₽");
    expect(norm(formatRub(12_345))).toBe("123,45 ₽");
    expect(norm(formatRub(-50_000))).toBe("−500 ₽");
    expect(norm(formatRub(50_000, { sign: true }))).toBe("+500 ₽");
  });

  it("formatRubCompact", () => {
    expect(norm(formatRubCompact(125_000_000))).toBe("1,3 млн ₽");
    expect(norm(formatRubCompact(35_000_000))).toBe("350 тыс. ₽");
  });

  it("линии и множители с запятой", () => {
    expect(formatLine(3.5)).toBe("3,5");
    expect(formatMultiplier(37.5)).toBe("×37,5");
    expect(formatMultiplier(3)).toBe("×3");
  });

  it("formatKickoff по московскому времени", () => {
    const now = new Date("2026-10-17T10:00:00Z"); // 13:00 МСК
    expect(formatKickoff("2026-10-17T16:30:00Z", now)).toBe("Сегодня, 19:30");
    expect(formatKickoff("2026-10-18T00:00:00Z", now)).toBe("Завтра, 03:00");
    expect(formatKickoff("2026-10-20T14:00:00Z", now)).toBe("20 октября, 17:00");
  });

  it("formatKickoffShort", () => {
    const now = new Date("2026-10-17T10:00:00Z");
    expect(formatKickoffShort("2026-10-17T16:30:00Z", now)).toBe("19:30");
    expect(formatKickoffShort("2026-10-18T00:00:00Z", now)).toBe("завтра 03:00");
    expect(formatKickoffShort("2026-10-20T14:00:00Z", now)).toBe("20.10 17:00");
  });

  it("formatMatchDay и formatCountdown", () => {
    const now = new Date("2026-10-17T10:00:00Z");
    expect(formatMatchDay("2026-10-17T16:30:00Z", now)).toBe("Сегодня");
    expect(formatMatchDay("2026-10-18T00:00:00Z", now)).toBe("Завтра");
    expect(formatMatchDay("2026-10-20T14:00:00Z", now)).toBe("вторник, 20 октября");
    expect(formatCountdown("2026-10-17T12:15:00Z", now)).toBe("через 2 ч 15 мин");
    expect(formatCountdown("2026-10-17T10:40:00Z", now)).toBe("через 40 мин");
    expect(formatCountdown("2026-10-20T10:00:00Z", now)).toBe("через 3 дн.");
    expect(formatCountdown("2026-10-17T09:00:00Z", now)).toBe("начинается");
  });

  it("currentMskPeriod учитывает смещение +3", () => {
    expect(currentMskPeriod(new Date("2026-10-31T20:59:00Z"))).toEqual({ year: 2026, month: 10 });
    expect(currentMskPeriod(new Date("2026-10-31T21:00:00Z"))).toEqual({ year: 2026, month: 11 });
  });

  it("nextMonthStartLabel", () => {
    expect(nextMonthStartLabel(new Date("2026-10-17T10:00:00Z"))).toBe("1 ноября");
    expect(nextMonthStartLabel(new Date("2026-12-31T20:00:00Z"))).toBe("1 января");
  });

  it("plural", () => {
    expect(plural(1, ["выбор", "выбора", "выборов"])).toBe("выбор");
    expect(plural(3, ["выбор", "выбора", "выборов"])).toBe("выбора");
    expect(plural(5, ["выбор", "выбора", "выборов"])).toBe("выборов");
    expect(plural(12, ["выбор", "выбора", "выборов"])).toBe("выборов");
    expect(plural(22, ["выбор", "выбора", "выборов"])).toBe("выбора");
  });
});
