import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const f = vi.hoisted(() => ({ model: vi.fn(), read: vi.fn(), prepare: vi.fn(), insert: vi.fn(), save: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } } }) }, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "owner" } }) }) }) }) }),
  createAdminClient: () => ({ from: () => ({ insert: (payload: unknown) => { f.insert(payload); return { select: () => ({ single: f.save }) }; } }) }),
}));
vi.mock("@/lib/anthropic", () => ({ createAnthropic: () => ({ messages: { create: f.model } }) }));
vi.mock("@/lib/assistant/tools", () => ({ ASSISTANT_TOOLS: [], executeAssistantTool: f.read }));
vi.mock("@/lib/assistant/prepare-action", () => ({ prepareAction: f.prepare }));
vi.mock("@/lib/usage", () => ({ logApiUsage: f.usage }));
import { POST } from "../route";
const request = () => new NextRequest("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "업무를 등록해줘" }] }) });
beforeEach(() => {
  vi.clearAllMocks();
  f.model.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "등록 완료했습니다" }, { type: "tool_use", id: "tool1", name: "create_task", input: { title: "점검" } }] });
  f.prepare.mockResolvedValue({ payload: { title: "점검", assignee_id: "me" }, display: { title: "업무 등록", fields: [{ label: "제목", value: "점검" }] } });
  f.save.mockResolvedValue({ data: { id: "draft", status: "pending" }, error: null });
  f.usage.mockResolvedValue(undefined);
});
describe("assistant write gate", () => {
  it("persists an approval draft, never runs the write tool, and suppresses false completion", async () => {
    const result = await (await POST(request())).json();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "me", tool_name: "create_task", payload: { title: "점검", assignee_id: "me" } }));
    expect(result.pendingActions).toEqual([{ id: "draft", status: "pending" }]);
    expect(result.text).toContain("확인할 초안"); expect(result.text).not.toContain("등록 완료");
    expect(f.model).toHaveBeenCalledTimes(1);
  });
  it("fails closed when draft persistence fails", async () => {
    f.save.mockResolvedValue({ data: null, error: { message: "missing table" } });
    const result = await (await POST(request())).json();
    expect(result.pendingActions).toEqual([]); expect(result.actions[0].ok).toBe(false);
    expect(result.actions[0].summary).toContain("업무에는 반영하지 않았습니다");
    expect(f.read).not.toHaveBeenCalled();
  });
  it("keeps successfully saved drafts visible when another action cannot be prepared", async () => {
    f.model.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, content: [
      { type: "tool_use", id: "tool1", name: "create_task", input: {} },
      { type: "tool_use", id: "tool2", name: "create_task", input: {} },
    ] });
    f.prepare.mockResolvedValueOnce({ payload: {}, display: { title: "업무 등록", fields: [] } }).mockRejectedValueOnce(new Error("담당자를 확인해 주세요"));
    const result = await (await POST(request())).json();
    expect(result.pendingActions).toHaveLength(1); expect(result.actions[0].summary).toContain("담당자를 확인");
  });
});
