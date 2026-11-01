"use server";

import { safeAuthRedirect } from "@/lib/auth-redirect";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeAuthRedirect(formData.get("redirect"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?redirect=${encodeURIComponent(redirectTo)}&error=${encodeURIComponent("이메일 또는 비밀번호가 올바르지 않습니다")}`);
  }
  redirect(redirectTo);
}
