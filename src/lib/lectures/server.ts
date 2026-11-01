import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const lectureReply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function lectureAuth() {
 const db = await createClient(); const { data: { user } } = await db.auth.getUser();
 if (!user) return null;
 const { data } = await db.from("profiles").select("id").eq("id",user.id).single();
 return data ? { db, user } : null;
}
export async function lectureBody(req: NextRequest): Promise<Record<string, unknown>> {
 if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) throw new Error("요청 주소를 확인해 주세요.");
 const text = await req.text(); if (text.length>200000) throw new Error("내용이 너무 길어요. 문서를 나누어 저장해 주세요.");
 const body = JSON.parse(text); if (!body || typeof body!=="object" || Array.isArray(body)) throw new Error("입력 내용을 확인해 주세요.");
 return body;
}
export function savedVersion(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v)<1) throw new Error("최신 저장 내용을 다시 열어 주세요."); return Number(v); }
export const lectureError = (e: unknown) => lectureReply({ error: e instanceof Error && !(e instanceof SyntaxError) ? e.message : "입력 내용을 확인해 주세요." },400);
export const staleLecture = () => lectureReply({ error: "다른 창에서 수정됐어요. 작성 내용을 복사해 둔 뒤 최신 내용을 다시 열어 주세요." },409);
