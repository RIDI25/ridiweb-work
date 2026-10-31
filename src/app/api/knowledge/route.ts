import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uuidValue } from "@/lib/assistant/action-types";
export async function GET(req: NextRequest) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!user) return reply({ error: "다시 로그인해 주세요." }, 401);
  const { data: profile } = await db.from("profiles").select("id").eq("id", user.id).single();
  if (!profile) return reply({ error: "팀원 로그인이 필요합니다." }, 403);
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    try { uuidValue(id); } catch { return reply({ error: "노트 주소를 확인해 주세요." }, 400); }
    const { data, error } = await db.from("vault_notes").select("id,title,path,body,vault_name,source_modified_at").eq("id", id).maybeSingle();
    if (error) return reply({ error: "노트를 불러오지 못했어요." }, 500);
    return data ? reply({ note: data }) : reply({ error: "노트를 찾지 못했어요." }, 404);
  }
  const [hits, state] = await Promise.all([
    db.rpc("search_workspace_notes", { p_query: (req.nextUrl.searchParams.get("q") || "").slice(0, 120), p_source: "vault", p_limit: 30 }),
    db.from("vault_sync_state").select("*").eq("owner_id", user.id).maybeSingle(),
  ]);
  return hits.error || state.error ? reply({ error: "연결 자료를 불러오지 못했어요." }, 500) : reply({ notes: hits.data, state: state.data });
}
