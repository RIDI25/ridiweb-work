import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { uuidValue } from "@/lib/assistant/action-types";
import { ATTACHMENT_BUCKET, fileSpec } from "@/lib/assistant/attachments";
import { inspectAttachment } from "@/lib/assistant/attachment-content";
export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function session() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from("profiles").select("id").eq("id",user.id).maybeSingle();
  return data ? { db, user } : null;
}
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) return reply({ error: "잘못된 요청이에요." },403);
  const auth = await session(); if (!auth) return reply({ error: "다시 로그인해 주세요." },401);
  try {
    const input = await req.json(), id = uuidValue(input.id), admin = createAdminClient();
    if (input.operation === "init") {
      const spec = fileSpec(input.filename, input.bytes), conversationId = uuidValue(input.conversationId);
      const { data: row, error } = await auth.db.rpc("reserve_assistant_attachment", { p_id: id, p_conversation: conversationId, p_filename: spec.filename, p_bytes: spec.bytes, p_mime: spec.mime, p_kind: spec.kind, p_ext: spec.ext });
      if (error || !row) return reply({ error: "파일 업로드를 준비하지 못했어요. 대화와 용량을 확인해 주세요. 하루 최대 50개·200MB까지 업로드할 수 있어요." },409);
      if (row.status === "ready") return reply({ ready: true, id });
      const signed = await admin.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(row.storage_path, { upsert: false });
      if (signed.error) throw new Error("파일 저장소에 연결하지 못했어요. 다시 시도해 주세요.");
      return reply({ id, path: signed.data.path, token: signed.data.token, mime: spec.mime });
    }
    if (input.operation !== "complete") return reply({ error: "잘못된 업로드 요청이에요." },400);
    const { data: row, error } = await auth.db.from("assistant_attachments").select("*").eq("id",id).eq("user_id",auth.user.id).maybeSingle();
    if (error || !row || row.status === "failed") return reply({ error: "첨부파일을 찾지 못했어요. 파일을 다시 선택해 주세요." },404);
    if (row.status === "ready") return reply({ ready: true, id });
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error("업로드 기한이 지났어요. 파일을 다시 선택해 주세요.");
    const download = await admin.storage.from(ATTACHMENT_BUCKET).download(row.storage_path);
    if (download.error || !download.data) throw new Error("파일 업로드가 끝나지 않았어요. 다시 보내기를 눌러 주세요.");
    const bytes = Buffer.from(await download.data.arrayBuffer());
    if (bytes.length !== row.bytes) throw new Error("파일 크기가 일치하지 않아요. 다시 선택해 주세요.");
    let inspected;
    try { inspected = await inspectAttachment(row.filename,bytes); }
    catch(e) {
      await admin.from("assistant_attachments").update({status:"failed"}).eq("id",id).eq("status","uploading");
      await admin.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path]);
      return reply({error:e instanceof Error?e.message:"이 파일을 읽지 못했어요. PDF나 이미지로 다시 첨부해 주세요."},400);
    }
    const updated = await admin.from("assistant_attachments").update({ status: "ready", sha256: inspected.sha256, extracted_text: inspected.extracted_text, pages: inspected.pages, note: inspected.note }).eq("id",id).eq("status","uploading").select("id").maybeSingle();
    if (updated.error || !updated.data) throw new Error("파일 처리 결과를 확인하지 못했어요. 다시 보내기를 눌러 주세요.");
    return reply({ ready:true,id,note:inspected.note });
  } catch(e) { return reply({ error:e instanceof Error?e.message:"파일을 준비하지 못했어요." },400); }
}
export async function GET(req: NextRequest) {
  const auth=await session();if(!auth)return reply({error:"다시 로그인해 주세요."},401);
  try {
    const id=uuidValue(req.nextUrl.searchParams.get("id"));
    const {data,error}=await auth.db.from("assistant_attachments").select("storage_path,filename,mime,message_id,status").eq("id",id).eq("user_id",auth.user.id).maybeSingle();
    if(error||!data||data.status!=="ready"||!data.message_id)return reply({error:"첨부파일을 찾지 못했어요."},404);
    const preview=req.nextUrl.searchParams.get("preview")==="1";
    if(preview&&!data.mime.startsWith("image/"))return reply({error:"이미지만 미리 볼 수 있어요."},400);
    const signed=await createAdminClient().storage.from(ATTACHMENT_BUCKET).createSignedUrl(data.storage_path,60,preview?{}:{download:data.filename});
    if(signed.error)throw new Error("첨부파일을 열지 못했어요.");
    return new NextResponse(null,{status:302,headers:{Location:signed.data.signedUrl,"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
  }catch{return reply({error:"첨부파일을 열지 못했어요."},400);}
}
