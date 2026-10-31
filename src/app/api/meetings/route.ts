import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { meetingInput } from "@/lib/notes";
import { uuidValue } from "@/lib/assistant/action-types";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function session() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from("profiles").select("id").eq("id", user.id).single();
  return data ? { db, user } : null;
}
export async function GET(req: NextRequest) {
  const auth = await session();
  if (!auth) return reply({ error: "다시 로그인해 주세요." }, 401);
  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (id) {
    try { uuidValue(id); } catch { return reply({ error: "회의록 주소를 확인해 주세요." }, 400); }
    const { data, error } = await auth.db.from("meeting_notes").select("*").eq("id", id).maybeSingle();
    if (error) return reply({ error: "회의록을 불러오지 못했어요." }, 500);
    return data ? reply({ note: data }) : reply({ error: "회의록을 찾지 못했어요." }, 404);
  }
  const page = Math.max(0, Math.min(10000, Number(params.get("page")) || 0));
  let query = auth.db.from("meeting_notes").select("id,title,meeting_date,client_id,participants,archived,updated_at", { count: "exact" }).eq("archived", params.get("archived") === "true").order("meeting_date", { ascending: false }).order("id").range(page * 30, page * 30 + 29);
  if (params.get("q")) query = query.ilike("title", `%${params.get("q")!.slice(0, 120).replace(/[\\%_]/g, "\\$&")}%`);
  if (params.get("client")) { try { query = query.eq("client_id", uuidValue(params.get("client"))); } catch { return reply({ error: "고객사를 확인해 주세요." }, 400); } }
  const { data, error, count } = await query;
  return error ? reply({ error: "회의록 목록을 불러오지 못했어요." }, 500) : reply({ notes: data, count });
}
export async function POST(req: NextRequest) { return write(req, false); }
export async function PATCH(req: NextRequest) { return write(req, true); }
async function write(req: NextRequest, update: boolean) {
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) return reply({ error: "잘못된 요청입니다." }, 403);
  const auth = await session();
  if (!auth) return reply({ error: "다시 로그인해 주세요." }, 401);
  let input: Record<string, unknown>;
  try { input = await req.json(); if (!input || Array.isArray(input) || typeof input !== "object") throw new Error(); } catch { return reply({ error: "입력 내용을 확인해 주세요." }, 400); }
  try {
    const values = meetingInput(input);
    if (update) {
      const id = uuidValue(input.id);
      if (!Number.isSafeInteger(input.version) || Number(input.version) < 1 || typeof input.archived !== "boolean") throw new Error("저장된 회의록을 다시 확인해 주세요.");
      const { data, error } = await auth.db.from("meeting_notes").update({ ...values, archived: input.archived }).eq("id", id).eq("version", input.version).select("*").maybeSingle();
      if (error) return reply({ error: "저장하지 못했어요. 연결과 고객사를 확인해 주세요." }, 500);
      return data ? reply({ note: data }) : reply({ error: "다른 곳에서 수정됐어요. 현재 내용을 복사해 두고 최신 회의록을 다시 열어 주세요." }, 409);
    }
    const { data, error } = await auth.db.from("meeting_notes").insert({ ...values, created_by: auth.user.id }).select("*").single();
    return error ? reply({ error: "저장하지 못했어요. 연결과 고객사를 확인해 주세요." }, 500) : reply({ note: data }, 201);
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "입력 내용을 확인해 주세요." }, 400); }
}
