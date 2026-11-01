"use server";

import { requireOwner } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { collaborationPatch, type CollaborationFields } from "@/lib/service-partners";

export async function saveServicePartnership(id: string, fields: CollaborationFields) {
  await requireOwner();
  try {
    const patch = collaborationPatch(fields);
    const db = await createClient();
    // The existing owner policy and restrictive Optify scope remain authoritative.
    const { error } = await db.from("client_services").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id").single();
    if (error) return { ok: false, error: error.code === "23503" ? "등록된 협력사를 선택해 주세요." : "저장하지 못했습니다. 권한과 연결 정보를 확인해 주세요." };
    revalidatePath("/clients", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "저장하지 못했습니다." };
  }
}

/** Called after existing RLS-protected contract mutations to expire navigation data. */
export async function refreshServiceViews() {
  await requireOwner();
  revalidatePath("/clients", "layout");
}
