import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uuidValue, textValue } from "@/lib/assistant/action-types";
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function session() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from("profiles").select("id").eq("id", user.id).single();
  return data ? { db, user } : null;
}
export async function GET(req: NextRequest) {
  const auth = await session(); if (!auth) return reply({ error: "다시 로그인해 주세요." }, 401);
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    try { uuidValue(id); } catch { return reply({ error: "대화를 선택해 주세요." }, 400); }
    const expired = await auth.db.rpc("expire_assistant_turn", { p_conversation: id });
    if (expired.error) return reply({ error: "대화를 찾지 못했어요." }, 404);
    const page = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get("page")) || 0));
    const [conversation, messages] = await Promise.all([
      auth.db.from("assistant_conversations").select("id,title,pinned,active_turn_id,archived_at,updated_at").eq("id", id).single(),
      auth.db.from("assistant_messages").select("id,role,content,context,metadata,created_at", { count: "exact" }).eq("conversation_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * 100, page * 100 + 99),
    ]);
    if (conversation.error || messages.error) return reply({ error: "대화를 불러오지 못했어요." }, 500);
    return reply({ conversation: conversation.data, messages: (messages.data || []).reverse(), more: (messages.count || 0) > (page + 1) * 100 });
  }
  const [conversations, archives, connection] = await Promise.all([
    auth.db.from("assistant_conversations").select("id,title,pinned,updated_at,active_turn_id").is("archived_at", null).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(200),
    auth.db.from("assistant_archives").select("week_start,status,saved_at,error,summary_path").order("week_start", { ascending: false }).limit(1),
    auth.db.from("vault_sync_state").select("last_success_at,error").eq("owner_id", auth.user.id).maybeSingle(),
  ]);
  if (conversations.error || archives.error || connection.error) return reply({ error: "대화 목록을 불러오지 못했어요." }, 500);
  return reply({ conversations: conversations.data, archive: archives.data?.[0] || null, connection: connection.data });
}
export async function POST(req: NextRequest) { return write(req, false); }
export async function PATCH(req: NextRequest) { return write(req, true); }
async function write(req: NextRequest, update: boolean) {
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) return reply({ error: "잘못된 요청입니다." }, 403);
  const auth = await session(); if (!auth) return reply({ error: "다시 로그인해 주세요." }, 401);
  try {
    const input = await req.json();
    if (update) {
      const id = uuidValue(input.id);
      const patch: { pinned?: boolean; title?: string } = {};
      if (typeof input.pinned === "boolean") patch.pinned = input.pinned;
      if (input.title !== undefined) patch.title = textValue(input.title, "대화 제목", true, 200)!;
      if (!Object.keys(patch).length) throw new Error("변경할 내용을 선택해 주세요.");
      const { data, error } = await auth.db.from("assistant_conversations").update(patch).eq("id", id).is("archived_at", null).select("id,title,pinned,updated_at,active_turn_id").maybeSingle();
      return error || !data ? reply({ error: "대화 설정을 바꾸지 못했어요. 목록을 새로고침해 주세요." }, 409) : reply({ conversation: data });
    }
    const { data, error } = await auth.db.from("assistant_conversations").insert({ user_id: auth.user.id, title: "새 대화" }).select("id,title,pinned,updated_at,active_turn_id").single();
    return error ? reply({ error: "새 대화를 만들지 못했어요." }, 500) : reply({ conversation: data }, 201);
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "입력 내용을 확인해 주세요." }, 400); }
}
