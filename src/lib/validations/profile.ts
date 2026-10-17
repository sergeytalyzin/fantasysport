import { z } from "zod";
import { nicknameSchema } from "./auth";

export const profileSchema = z.object({ nickname: nicknameSchema });
export type ProfileValues = z.infer<typeof profileSchema>;

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function validateAvatar(file: File): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return "Поддерживаются PNG, JPEG и WebP";
  if (file.size > AVATAR_MAX_BYTES) return "Размер файла — не больше 2 МБ";
  return null;
}
