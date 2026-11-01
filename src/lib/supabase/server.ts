import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** 서버 컴포넌트·라우트 핸들러·서버 액션용 Supabase 클라이언트 (사용자 세션) */
// Share the cookie-bound client within one server render, never across requests.
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출된 경우 무시(미들웨어가 세션 갱신 담당).
          }
        },
      },
    },
  );
});

/**
 * 서버 전용 관리자 클라이언트 (service role).
 * RLS를 우회하므로 서버 코드에서만, 신중하게 사용. 클라이언트 번들에 포함 금지.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
