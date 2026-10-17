"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, Loader2 } from "lucide-react";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { UserAvatar } from "@/components/layout/user-avatar";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useUpdateNickname, useUploadAvatar } from "@/features/profile/hooks";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { type ProfileValues, profileSchema, validateAvatar } from "@/lib/validations/profile";
import type { ProfileSummary } from "@/types/domain";

export function ProfileEditor({ profile }: { profile: ProfileSummary }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const updateNickname = useUpdateNickname();
  const uploadAvatar = useUploadAvatar();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: { nickname: profile.nickname },
  });

  const onSubmit = form.handleSubmit((values) =>
    updateNickname.mutate(values.nickname, {
      onSuccess: () => toast.success("Никнейм сохранён"),
      onError: (e) => toast.error(errorMessage(e)),
    }),
  );

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const problem = validateAvatar(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    uploadAvatar.mutate(file, {
      onSuccess: () => toast.success("Аватар обновлён"),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-white/[0.07] bg-surface-1 p-5 sm:flex-row sm:items-center">
      <div className="relative self-center">
        <UserAvatar nickname={profile.nickname} url={profile.avatar_url} className="size-24 text-xl" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full border-4 border-surface-1 bg-primary text-primary-foreground"
          aria-label="Загрузить аватар"
          disabled={uploadAvatar.isPending}
        >
          {uploadAvatar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
      <form onSubmit={onSubmit} className="flex-1 space-y-3" noValidate>
        <FormField id="nickname" label="Никнейм" error={form.formState.errors.nickname?.message}>
          <div className="flex gap-2">
            <Input id="nickname" {...form.register("nickname")} />
            <Button type="submit" disabled={updateNickname.isPending || !form.formState.isDirty}>
              {updateNickname.isPending ? <Loader2 className="animate-spin" /> : null} Сохранить
            </Button>
          </div>
        </FormField>
        <p className="text-xs text-muted-foreground">В PICKUP с {formatDate(profile.created_at)}</p>
      </form>
    </section>
  );
}
