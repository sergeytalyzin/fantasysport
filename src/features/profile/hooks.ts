"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/auth-provider";
import { unwrap } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProfileSummary } from "@/types/domain";

export function useProfileSummary() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.profileSummary(user?.id ?? ""),
    enabled: Boolean(user),
    queryFn: async () => {
      const rows = unwrap(await getSupabaseBrowserClient().rpc("get_my_profile_summary")) as ProfileSummary[];
      return rows[0] ?? null;
    },
  });
}

function useInvalidateProfile() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profileSummaryAll });
    void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboardAll });
  };
}

export function useUpdateNickname() {
  const { user } = useAuth();
  const invalidate = useInvalidateProfile();
  return useMutation({
    mutationFn: async (nickname: string) => {
      const { error } = await getSupabaseBrowserClient().from("profiles").update({ nickname }).eq("id", user!.id);
      if (error?.code === "23505") throw new Error("Этот никнейм уже занят");
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useUploadAvatar() {
  const { user } = useAuth();
  const invalidate = useInvalidateProfile();
  return useMutation({
    mutationFn: async (file: File) => {
      const supabase = getSupabaseBrowserClient();
      const ext = file.type.split("/")[1] ?? "png";
      // Политика Storage разрешает запись только в папку со своим id.
      const path = `${user!.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error } = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", user!.id);
      if (error) throw error;
      return data.publicUrl;
    },
    onSuccess: invalidate,
  });
}
