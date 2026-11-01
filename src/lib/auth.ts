import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

/** 현재 세션의 프로필(역할 포함). 미인증이면 null. */
// Request-local memoization only: never reuse a profile across users/requests.
export const getMyProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data ?? null;
});

/** 로그인 필수. 미인증이면 /login으로. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** owner 전용. 아니면 홈으로. */
export async function requireOwner(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "owner") redirect("/");
  return profile;
}
