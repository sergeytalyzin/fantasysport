/** Сведения об источнике фото спортсмена (для атрибуции по условиям лицензии). */
export interface PhotoCredit {
  photo_source: string | null;
  photo_license: string | null;
  photo_author: string | null;
  photo_page_url: string | null;
}

/** «Фото: Александр Головко, CC BY-SA 3.0, Wikimedia Commons» или «© NHL — официальное фото лиги». */
export function photoCreditText(credit: PhotoCredit | null | undefined): string | null {
  if (!credit?.photo_license) return null;
  if (credit.photo_source !== "wikimedia") return credit.photo_license;
  return ["Фото:", [credit.photo_author, credit.photo_license, "Wikimedia Commons"].filter(Boolean).join(", ")].join(" ");
}
