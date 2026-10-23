import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 사업자등록증 (고객사·협업사 기본정보, 2026-10-23).
 * 비공개 Storage 버킷 client-docs/<clientId>/business-registration/<시각>.<확장자> 에 한 장만 둔다(새로 올리면 옛 파일 삭제).
 * 버킷 정책 없이 서버에서 팀원 확인 뒤 관리자 키로 읽고 쓴다. 미리보기는 10분짜리 서명 URL.
 */
const BUCKET = "client-docs";
const MAX = 4 * 1024 * 1024; // Vercel 요청 본문 한도(4.5MB) 안
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

async function guard(clientId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: new NextResponse("Unauthorized", { status: 401 }) };
  const { data: me } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!me) return { error: new NextResponse("Forbidden", { status: 403 }) };
  const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return { error: NextResponse.json({ ok: false, error: "고객사를 찾을 수 없습니다" }, { status: 404 }) };
  return { admin: createAdminClient() };
}

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (!data) await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX, allowedMimeTypes: Object.keys(TYPES) });
}

const dir = (id: string) => `${id}/business-registration`;

async function current(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin.storage.from(BUCKET).list(dir(id), { sortBy: { column: "created_at", order: "desc" } });
  return (data ?? []).filter((f) => f.name && !f.name.startsWith("."));
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  await ensureBucket(g.admin);
  const files = await current(g.admin, id);
  if (!files.length) return NextResponse.json({ ok: true, file: null });
  const f = files[0];
  const path = `${dir(id)}/${f.name}`;
  const { data } = await g.admin.storage.from(BUCKET).createSignedUrl(path, 600);
  const type = (f.metadata as { mimetype?: string } | null)?.mimetype ?? (f.name.endsWith(".pdf") ? "application/pdf" : "image/*");
  return NextResponse.json({ ok: true, file: { url: data?.signedUrl ?? null, type, uploadedAt: f.created_at, size: (f.metadata as { size?: number } | null)?.size ?? null } });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ ok: false, error: "JPG·PNG·WEBP·PDF 파일만 올릴 수 있습니다" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ ok: false, error: "4MB 이하 파일만 올릴 수 있습니다" }, { status: 400 });
  await ensureBucket(g.admin);
  const old = await current(g.admin, id);
  const path = `${dir(id)}/${Date.now()}.${ext}`;
  const { error } = await g.admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return NextResponse.json({ ok: false, error: `업로드 실패: ${error.message}` }, { status: 500 });
  if (old.length) await g.admin.storage.from(BUCKET).remove(old.map((f) => `${dir(id)}/${f.name}`));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("error" in g) return g.error;
  const files = await current(g.admin, id);
  if (files.length) await g.admin.storage.from(BUCKET).remove(files.map((f) => `${dir(id)}/${f.name}`));
  return NextResponse.json({ ok: true });
}
