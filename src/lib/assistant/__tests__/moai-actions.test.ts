import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeMoaiSessions, prepareMoaiAction } from "../moai-actions";
import { CHECKS, TEMPLATE_BODIES, type Gathering } from "@/lib/moai/types";
import { allowedMoaiPath } from "@/lib/workspace-access";

const id = "10000000-0000-4000-8000-000000000001";
const session = { id, title: "1회차", date: "2026-11-05", start: "10:00", end: "12:00", location: "기존 장소" };
function database(tables: Record<string, { data: unknown; error?: unknown }>) {
  return { from(table: string) {
    const result = tables[table] || { data: null, error: "unexpected table" };
    const query = { select() { return query; }, eq() { return query; }, ilike() { return query; }, limit() { return query; }, maybeSingle() { return Promise.resolve(result); }, then: Promise.resolve(result).then.bind(Promise.resolve(result)) };
    return query;
  } } as unknown as SupabaseClient;
}
const gathering = { id, title: "목요일 스터디", kind: "study", period: "2026-11", theme: "독서", state: "approved", capacity: 12, fee: 10000, sessions: [session], checklist: [{ id: "c", title: "준비", done: true }], ...TEMPLATE_BODIES, session_notes: { [id]: "메모 보존" }, archived: false, version: 3, approved_by: id, approved_version: 3, reviewed_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" } as Gathering;
const membership = { data: { role: "operator" } };

describe("MoAI assistant preparation", () => {
  it("builds one frozen draft with four sessions, common templates and no business writes", async () => {
    const db = database({ moai_members: membership, moai_gatherings: { data: [] }, moai_templates: { data: [{ kind: "survey", body: "저장된 공통 설문" }] } });
    const result = await prepareMoaiAction(db, "create_moai_gathering", { title: "11월 목요일 스터디", kind: "study", period: "2026-11", sessions: [5, 12, 19, 26].map(day => ({ date: `2026-11-${String(day).padStart(2, "0")}`, start: "10:00", end: "12:00" })) }, id);
    expect(result.payload.values).toMatchObject({ survey: "저장된 공통 설문", fee: 0 });
    expect(result.payload.values?.sessions).toHaveLength(4);
    expect(new Set(result.payload.values?.sessions.map(s => s.id)).size).toBe(4);
    expect(result.payload.values?.checklist).toHaveLength(CHECKS.length);
    expect(result.display.fields.find(f => f.label === "참가비")?.value).toContain("미정");
    expect(result.display.note).toContain("최종 승인은 별도");
  });
  it("patches by existing ID and preserves every untouched session and field", async () => {
    const result = await prepareMoaiAction(database({ moai_members: membership, moai_gatherings: { data: gathering } }), "upsert_moai_sessions", { gathering_id: id, sessions: [{ id, start: "11:00", end: "13:00" }, { date: "2026-11-12", start: "10:00", end: "12:00" }] }, id);
    expect(result.payload).toMatchObject({ gathering_id: id, expected_version: 3 });
    expect(result.payload.sessions?.[0]).toEqual({ ...session, start: "11:00", end: "13:00" });
    expect(result.payload).not.toHaveProperty("plan");
    expect(result.display.fields.find(f => f.label === "회차 변경")?.value).toContain("10:00–12:00");
    expect(result.display.fields.find(f => f.label === "회차 변경")?.value).toContain("11:00–13:00");
    const appended = mergeMoaiSessions([{ date: "2026-11-12" }], [session]);
    expect(appended.sessions[0]).toEqual(session);
  });
  it("rejects missing permission, duplicate gathering, broken lookup and archived targets", async () => {
    await expect(prepareMoaiAction(database({ moai_members: { data: null } }), "create_moai_gathering", {}, id)).rejects.toThrow(/권한/);
    for (const data of [{ data: [{ id }] }, { data: null, error: "offline" }]) await expect(prepareMoaiAction(database({ moai_members: membership, moai_gatherings: data }), "create_moai_gathering", { title: "기존", kind: "study" }, id)).rejects.toThrow();
    await expect(prepareMoaiAction(database({ moai_members: membership, moai_gatherings: { data: { ...gathering, archived: true } } }), "upsert_moai_sessions", { gathering_id: id, sessions: [{ date: "2026-11-12" }] }, id)).rejects.toThrow(/복원/);
  });
  it("rejects invalid dates, time order, unknown IDs, duplicate IDs and empty changes", async () => {
    for (const sessions of [[{ date: "2026-02-30" }], [{ date: "2026-11-12", start: "12:00", end: "10:00" }], [{ date: "2026-11-12", start: "10:00" }], [{ id: "20000000-0000-4000-8000-000000000002", date: "2026-11-12" }], [{ id }, { id }], [], Array.from({ length: 61 }, () => ({ date: "2026-11-12" }))]) {
      await expect(prepareMoaiAction(database({ moai_members: membership, moai_gatherings: { data: gathering } }), "upsert_moai_sessions", { gathering_id: id, sessions }, id)).rejects.toThrow();
    }
    expect(() => mergeMoaiSessions([{ title: session.title, date: session.date, start: session.start, end: session.end }], [session])).toThrow(/이미/);
  });
  it("lets MoAI operators reach confirmation without opening other assistant API paths", () => {
    expect(allowedMoaiPath("/api/assistant/actions")).toBe(true);
    expect(allowedMoaiPath("/api/assistant/actions/other")).toBe(false);
    expect(allowedMoaiPath("/api/lectures")).toBe(false);
  });
});
