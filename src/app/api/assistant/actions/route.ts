import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACTION_SELECT, uuidValue } from "@/lib/assistant/action-types";

const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function session() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: reply({ error: "다시 로그인해 주세요." }, 401) };
  const { data } = await db.from("profiles").select("id").eq("id", user.id).single();
  if (!data) return { error: reply({ error: "팀원 계정으로 로그인해 주세요." }, 403) };
  return { db, user };
}

export async function GET(req: NextRequest) {
  const auth = await session();
  if (auth.error) return auth.error;
  const { db, user } = auth;
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  try { if (conversationId) uuidValue(conversationId); } catch { return reply({ error: "대화를 확인해 주세요." }, 400); }
  const scoped = () => {
    const query = db.from("assistant_action_requests").select(ACTION_SELECT, { count: "exact" }).eq("user_id", user.id);
    return conversationId ? query.eq("conversation_id", conversationId) : query;
  };
  const [pending, recent] = await Promise.all([
    scoped().eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at").limit(100),
    scoped().neq("status", "pending").order("resolved_at", { ascending: false }).limit(10),
  ]);
  if (pending.error || recent.error) return reply({ error: "확인 초안을 불러오지 못했습니다. 데이터베이스 설정과 연결을 확인해 주세요." }, 503);
  return reply({ actions: [...(pending.data ?? []), ...(recent.data ?? [])], more: (pending.count ?? 0) > 100 });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return reply({ error: "잘못된 요청입니다." }, 403);
  const auth = await session();
  if (auth.error) return auth.error;
  let body;
  try {
    body = await req.json();
    uuidValue(body.id);
    if (!["confirm", "cancel"].includes(body.decision)) throw new Error();
  } catch { return reply({ error: "확인할 초안을 선택해 주세요." }, 400); }
  // No tool name, payload, owner or result is accepted from the browser.
  const { data, error } = await auth.db.rpc("resolve_chat_assistant_action", { request_id: body.id, decision: body.decision });
  if (error) return reply({ error: "초안 처리 결과를 확인하지 못했습니다. 목록을 새로 불러와 확인해 주세요." }, 409);
  return reply({ action: data });
}
