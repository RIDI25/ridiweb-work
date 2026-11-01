import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16: 기존 `middleware` 컨벤션의 후속. 렌더 전 서버에서 실행되어
// 세션 갱신 + 라우트 가드를 담당한다.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // 정적 파일·이미지·favicon 제외한 모든 경로
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
