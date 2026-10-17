import { z } from "zod";

export const NICKNAME_REGEX = /^[A-Za-zА-Яа-яЁё0-9_.-]{3,24}$/;

export const nicknameSchema = z
  .string()
  .trim()
  .regex(NICKNAME_REGEX, "3–24 символа: буквы, цифры, «_», «.», «-»");

const email = z.string().trim().toLowerCase().email("Введите корректный email");
const password = z.string().min(8, "Минимум 8 символов").max(72, "Максимум 72 символа");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Введите пароль"),
});

export const registerSchema = z
  .object({
    nickname: nicknameSchema,
    email,
    password,
    confirmPassword: z.string(),
    acceptRules: z.literal(true, { message: "Подтвердите, что ознакомились с правилами" }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Пароли не совпадают",
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Пароли не совпадают",
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.input<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
