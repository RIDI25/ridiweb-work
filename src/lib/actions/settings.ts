"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { ensureOnboardingTasks } from "@/lib/actions/onboarding";

interface ClientPatch {
  name?: string;
  /** 0032 고객사/협업사 */
  kind?: "client" | "partner";
  gsc_site_url?: string | null;
  ga4_property_id?: string | null;
  status?: "active" | "paused" | "ended";
  memo?: string | null;
  // 0028 회사 정보
  industry?: string | null;
  region?: string | null;
  website_url?: string | null;
  blog_url?: string | null;
  place_url?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  // 0029
  google_auto_fetch?: boolean;
}

/** 클라이언트 저장(신규 insert 또는 update). owner만 — RLS로 강제. */
export async function saveClient(
  id: string | null,
  patch: ClientPatch,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("clients").update(patch).eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: inserted, error } = await supabase
    .from("clients")
    .insert({ ...patch, created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  // 신규 고객사는 온보딩 체크리스트 자동 생성 [A-2]
  if (inserted?.id) await ensureOnboardingTasks(inserted.id);
  return { ok: true };
}

/** 고객사 삭제. owner만 — 내부 클라이언트(옵티파이)는 삭제 불가.
 * 프리셋·키워드·플랜·콘텐츠·리포트·온보딩·계약은 FK cascade로 함께 삭제,
 * 리드·업무·일정은 연결만 해제(set null). API 사용량 로그는 FK에 on delete가
 * 없어 삭제를 막으므로, 로그는 보존한 채 연결만 해제한 뒤 삭제한다. */
export async function deleteClient(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  // admin 클라이언트를 쓰기 전에 서버에서 owner를 직접 검증 (RLS와 이중 차단)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "owner") {
    return { ok: false, error: "owner만 삭제할 수 있습니다." };
  }

  const { data: target } = await supabase
    .from("clients")
    .select("id, is_internal")
    .eq("id", id)
    .single();
  if (!target) return { ok: false, error: "고객사를 찾을 수 없습니다." };
  if (target.is_internal) {
    return { ok: false, error: "내부 클라이언트(옵티파이)는 삭제할 수 없습니다." };
  }

  const admin = createAdminClient();
  const { error: detachErr } = await admin
    .from("api_usage_logs")
    .update({ client_id: null })
    .eq("client_id", id);
  if (detachErr) {
    return { ok: false, error: `사용량 로그 연결 해제 실패: ${detachErr.message}` };
  }

  const { error } = await supabase.from("clients").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** 채널 프리셋(jsonb) 저장. owner만. */
export async function savePreset(
  clientId: string,
  channel: string,
  preset: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("channel_settings")
    .upsert(
      { client_id: clientId, channel, preset },
      { onConflict: "client_id,channel" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** 채널 기본 담당자 저장. owner만 — RLS로 강제.
 * 미등록 채널이면 행을 생성(upsert) — update만 하면 조용히 실패한다. */
export async function saveChannelAssignee(
  clientId: string,
  channel: string,
  assignee: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("channel_settings")
    .upsert(
      { client_id: clientId, channel, default_assignee: assignee },
      { onConflict: "client_id,channel" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** 채널 계정/연결 정보 저장 (네이버 블로그 등). 비밀번호는 서버에서 암호화. owner만 — RLS로 강제.
 * password가 빈 값이면 기존 비밀번호 유지. 0020 마이그레이션 필요. */
export async function saveChannelConnection(
  clientId: string,
  channel: string,
  input: {
    accountId: string;
    password?: string;
    channelUrl: string;
    category: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    client_id: clientId,
    channel,
    account_id: input.accountId.trim() || null,
    channel_url: input.channelUrl.trim() || null,
    category: input.category.trim() || null,
  };
  if (input.password) {
    patch.account_password_encrypted = encryptSecret(input.password);
  }
  const { error } = await supabase
    .from("channel_settings")
    .upsert(patch, { onConflict: "client_id,channel" });
  if (error) {
    const hint = error.message.includes("account_id")
      ? " — supabase/migrations/0020_channel_connection.sql을 SQL Editor에서 실행하세요."
      : "";
    return { ok: false, error: error.message + hint };
  }
  return { ok: true };
}

/** 저장된 채널 계정 비밀번호 복호화 조회 (수동 발행 시 로그인용).
 * 로그인한 팀원만 — 행 접근 자체가 RLS로 제한된다. */
export async function revealChannelPassword(
  clientId: string,
  channel: string,
): Promise<{ ok: boolean; password?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const { data: me } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!me) return { ok: false, error: "팀에 등록된 계정만 볼 수 있습니다." };
  const { data, error } = await supabase
    .from("channel_settings")
    .select("account_password_encrypted")
    .eq("client_id", clientId)
    .eq("channel", channel)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data?.account_password_encrypted)
    return { ok: false, error: "저장된 비밀번호가 없습니다." };
  try {
    return { ok: true, password: decryptSecret(data.account_password_encrypted) };
  } catch {
    return { ok: false, error: "복호화 실패 — 비밀번호를 다시 저장해 주세요." };
  }
}

/** WP 연결 정보 저장. 비밀번호는 서버에서 암호화. owner만. */
export async function saveWpConnection(
  clientId: string,
  input: { wpUrl: string; wpUsername: string; wpPassword?: string },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    client_id: clientId,
    channel: "wordpress",
    wp_url: input.wpUrl || null,
    wp_username: input.wpUsername || null,
  };
  if (input.wpPassword) {
    patch.wp_app_password_encrypted = encryptSecret(input.wpPassword);
  }
  const { error } = await supabase
    .from("channel_settings")
    .upsert(patch, { onConflict: "client_id,channel" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
