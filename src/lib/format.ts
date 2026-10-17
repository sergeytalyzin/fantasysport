// Форматирование для русскоязычного интерфейса. Время — московское.

const TIME_ZONE = "Europe/Moscow";

const rubFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

/** Копейки → «12 345 ₽» (копейки показываются, только если они есть). */
export function formatRub(kopecks: number, { sign = false }: { sign?: boolean } = {}): string {
  const value = kopecks / 100;
  const formatted = rubFormatter.format(Math.abs(value));
  const prefix = value < 0 ? "−" : sign && value > 0 ? "+" : "";
  return `${prefix}${formatted} ₽`;
}

/** Компактная запись для узких мест: 1,2 млн ₽, 350 тыс. ₽. */
export function formatRubCompact(kopecks: number): string {
  const value = kopecks / 100;
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${numberFormatter.format(Math.round(abs / 100_000) / 10)} млн ₽`;
  if (abs >= 10_000) return `${sign}${numberFormatter.format(Math.round(abs / 1000))} тыс. ₽`;
  return formatRub(kopecks);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** 3.5 → «3,5». */
export function formatLine(line: number): string {
  return numberFormatter.format(line);
}

/** 37.5 → «×37,5». */
export function formatMultiplier(multiplier: number): string {
  return `×${numberFormatter.format(multiplier)}`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${numberFormatter.format(value)}%`;
}

const timeFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, day: "numeric", month: "long" });
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

/** «Сегодня, 19:30», «Завтра, 03:00», «21 октября, 17:00» (МСК). */
export function formatKickoff(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = dayKeyFormatter.format(date);
  const today = dayKeyFormatter.format(now);
  const tomorrow = dayKeyFormatter.format(new Date(now.getTime() + 86_400_000));
  const time = timeFormatter.format(date);
  if (day === today) return `Сегодня, ${time}`;
  if (day === tomorrow) return `Завтра, ${time}`;
  return `${dateFormatter.format(date)}, ${time}`;
}

const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit" });

/** Компактно для карточки: «19:30», «завтра 03:00», «20.10 17:00» (МСК). */
export function formatKickoffShort(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = dayKeyFormatter.format(date);
  const time = timeFormatter.format(date);
  if (day === dayKeyFormatter.format(now)) return time;
  if (day === dayKeyFormatter.format(new Date(now.getTime() + 86_400_000))) return `завтра ${time}`;
  return `${shortDateFormatter.format(date)} ${time}`;
}

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

/** Первое число следующего месяца по Москве: «1 ноября». */
export function nextMonthStartLabel(now: Date = new Date()): string {
  const { month } = currentMskPeriod(now);
  return `1 ${MONTHS_GENITIVE[month % 12]}`;
}

/** Текущий календарный месяц по Москве. */
export function currentMskPeriod(now: Date = new Date()): { year: number; month: number } {
  const [year, month] = dayKeyFormatter.format(now).split("-").map(Number);
  return { year, month };
}

/** Склонение: plural(3, ["выбор", "выбора", "выборов"]). */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
