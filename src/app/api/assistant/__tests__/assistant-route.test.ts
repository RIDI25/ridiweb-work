import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const f = vi.hoisted(() => ({ model: vi.fn(), read: vi.fn(), prepare: vi.fn(), insert: vi.fn(), save: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me" } } }) }, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "owner" } }) }) }) }) }),
  createAdminClient: () => ({ from: () => ({ insert: (payload: unknown) => { f.insert(payload); return { select: () => ({ single: f.save }) }; } }) }),
}));
vi.mock("@/lib/anthropic", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/anthropic")>(), createAnthropic: () => ({ messages: { create: f.model } }) }));
vi.mock("@/lib/assistant/tools", () => ({ ASSISTANT_TOOLS: [], executeAssistantTool: f.read }));
vi.mock("@/lib/assistant/prepare-action", () => ({ prepareAction: f.prepare }));
vi.mock("@/lib/usage", () => ({ logApiUsage: f.usage }));
import { POST } from "../route";
const request = (messages = [{ role: "user", content: "업무를 등록해줘" }]) => new NextRequest("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ messages }) });
beforeEach(() => {
  vi.clearAllMocks();
  f.model.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "등록 완료했습니다" }, { type: "tool_use", id: "tool1", name: "create_task", input: { title: "점검" } }] });
  f.prepare.mockResolvedValue({ payload: { title: "점검", assignee_id: "me" }, display: { title: "업무 등록", fields: [{ label: "제목", value: "점검" }] } });
  f.save.mockResolvedValue({ data: { id: "draft", status: "pending" }, error: null });
  f.usage.mockResolvedValue(undefined);
});
describe("assistant write gate", () => {
  it("continues a long planning conversation on Fable without creating work records", async () => {
    f.model.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn", content: [{ type: "text", text: "제안서는 목표, 진단 요약, 실행 범위, 일정 순서로 구성해 봅시다." }] });
    const response = await POST(request([{ role: "assistant", content: "기획 초안. ".repeat(2000) }, { role: "user", content: "이어서 미팅용 제안서 구성을 다듬어줘" }]));
    const result = await response.json();
    expect(result.ok).toBe(true); expect(result.text).toContain("제안서는 목표");
    expect(f.model).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-fable-5-1", messages: expect.arrayContaining([expect.objectContaining({ content: "기획 초안. ".repeat(2000) })]) }));
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.insert).not.toHaveBeenCalled();
    expect(f.usage).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-fable-5-1" }));
  });
  it("preserves reasoning blocks during a read-tool round before answering a planning question", async () => {
    const content = [{ type: "thinking", thinking: "업무를 조회한 뒤 계획을 제안한다.", signature: "provider-signature" }, { type: "tool_use", id: "read1", name: "list_tasks", input: {} }];
    f.model.mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content }).mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "조회한 업무를 바탕으로 우선순위를 제안합니다." }] });
    f.read.mockResolvedValue({ ok: true, result: "업무 1건" });
    const result = await (await POST(request([{ role: "user", content: "현재 업무를 보고 우선순위를 같이 정해줘" }]))).json();
    expect(result.ok).toBe(true); expect(f.model).toHaveBeenCalledTimes(2);
    expect(f.model.mock.calls[1][0].messages).toContainEqual({ role: "assistant", content });
    expect(f.model.mock.calls[1][0].messages).toContainEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "read1", content: "업무 1건", is_error: false }] });
    expect(f.insert).not.toHaveBeenCalled();
  });
  it("does not prepare actions from a refused model response", async () => {
    f.model.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "refusal", content: [{ type: "tool_use", id: "tool1", name: "create_task", input: { title: "점검" } }] });
    const result = await (await POST(request())).json();
    expect(result.ok).toBe(false); expect(result.error).toContain("답하지 않았어요");
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.insert).not.toHaveBeenCalled();
  });
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
