import { allowedMoaiPath } from "@/lib/workspace-access";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** 공개 경로(비인증 접근 허용). cron 경로는 각 라우트가 CRON_SECRET 으로 자체 인증한다 — 새 cron 을 만들면 여기에도 추가할 것 */
const PUBLIC_PATHS = ["/login", "/auth", "/api/daily-report/cron", "/api/tasks/cron", "/api/reports/cron"];

/**
 * 세션 갱신 + 라우트 가드.
 * 비인증 사용자가 보호 경로 접근 시 /login으로, 인증 사용자가 /login 접근 시 홈으로.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && !isPublic) {
    const { data: access, error } = await supabase.from("ridiweb_access").select("scope").eq("user_id",user.id).maybeSingle();
    if (error) return NextResponse.json({error:"업무 공간 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."},{status:503});
    if (access?.scope === "moai" && !allowedMoaiPath(pathname)) {
      if(pathname.startsWith("/api/")) return NextResponse.json({error:"이 업무 공간에 접근할 수 없어요."},{status:403});
      const url=request.nextUrl.clone();url.pathname="/moai";url.search="";return NextResponse.redirect(url);
    }
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
