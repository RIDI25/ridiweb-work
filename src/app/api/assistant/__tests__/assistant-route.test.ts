import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const f = vi.hoisted(() => ({ access: vi.fn(), model: vi.fn(), read: vi.fn(), prepare: vi.fn(), insert: vi.fn(), save: vi.fn(), usage: vi.fn(), begin: vi.fn(), finish: vi.fn(), history: vi.fn(), specialist: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) }, rpc: f.begin,
    from: (table: string) => table === "profiles" ? { select: () => ({ eq: () => ({ single: async () => ({ data: { role: "owner" } }) }) }) } : { select: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit: f.history }) }) }) }) },
  }),
  createAdminClient: () => ({ rpc: f.finish, from: () => ({ insert: (payload: unknown) => { f.insert(payload); return { select: () => ({ single: f.save }) }; } }) }),
}));
vi.mock("@/lib/anthropic", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/anthropic")>(), createAnthropic: () => ({ messages: { create: f.model } }) }));
vi.mock("@/lib/workspace-access", () => ({ workspaceAccess: f.access }));
vi.mock("@/lib/assistant/tools", () => ({ ASSISTANT_TOOLS: ["create_task","list_tasks","create_lecture_project","update_lecture_project","save_lecture_document","search_lectures","read_lecture","create_moai_gathering","upsert_moai_sessions","search_moai","read_moai","list_schedule"].map(name => ({name})), executeAssistantTool: f.read }));
vi.mock("@/lib/assistant/prepare-action", () => ({ prepareAction: f.prepare }));
vi.mock("@/lib/assistant/specialist", async (original) => ({ ...await original<typeof import("@/lib/assistant/specialist")>(), runSpecialist: f.specialist }));
vi.mock("@/lib/usage", () => ({ logApiUsage: f.usage }));
import { POST } from "../route";
const request = (messages = [{ role: "user", content: "업무를 등록해줘" }]) => {
  f.history.mockResolvedValue({ data: [...messages].reverse().map(m => ({ ...m, context: "전체 업무" })), error: null });
  return new NextRequest("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ conversationId: "10000000-0000-4000-8000-000000000001", requestId: "10000000-0000-4000-8000-000000000002", message: messages.at(-1)!.content }) });
};
beforeEach(() => {
  vi.clearAllMocks();
  f.access.mockResolvedValue({restricted:false,moaiRole:"reviewer"});
  f.begin.mockResolvedValue({ data: { status: "started" }, error: null });
  f.finish.mockResolvedValue({ data: "saved-message", error: null });
  f.model.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "등록 완료했습니다" }, { type: "tool_use", id: "tool1", name: "create_task", input: { title: "점검" } }] });
  f.prepare.mockResolvedValue({ payload: { title: "점검", assignee_id: "me" }, display: { title: "업무 등록", fields: [{ label: "제목", value: "점검" }] } });
  f.save.mockResolvedValue({ data: { id: "draft", status: "pending" }, error: null });
  f.usage.mockResolvedValue(undefined);
  f.specialist.mockResolvedValue({ ok: true, result: "Astra 분석 결과", summary: "GPT Astra · 자료 분석 완료" });
});
describe("assistant write gate", () => {
  it("never calls a model when the user message could not be saved", async () => {
    f.begin.mockResolvedValue({ error: { message: "offline" } });
    const response = await POST(request()); expect(response.status).toBe(409); expect(f.model).not.toHaveBeenCalled();
  });
  it("deduplicates an in-flight request without calling the model twice", async () => {
    f.begin.mockResolvedValue({ data: { status: "running" } });
    const response = await POST(request()); expect(response.status).toBe(202); expect(f.model).not.toHaveBeenCalled();
  });
  it("persists provider failures as part of the conversation", async () => {
    f.model.mockRejectedValue(new Error("provider unavailable")); await POST(request());
    expect(f.finish).toHaveBeenCalledWith("finish_assistant_turn", expect.objectContaining({p_response: expect.objectContaining({ok:false})}));
  });
  it("continues a long planning conversation on Fable without creating work records", async () => {
    f.model.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn", content: [{ type: "text", text: "제안서는 목표, 진단 요약, 실행 범위, 일정 순서로 구성해 봅시다." }] });
    const response = await POST(request([{ role: "assistant", content: "기획 초안. ".repeat(2000) }, { role: "user", content: "이어서 미팅용 제안서 구성을 다듬어줘" }]));
    const result = await response.json();
    expect(result.ok).toBe(true); expect(result.text).toContain("제안서는 목표");
    expect(f.model).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-fable-5-1", messages: expect.arrayContaining([expect.objectContaining({ content: "기획 초안. ".repeat(2000) })]) }), expect.objectContaining({ maxRetries: 0 }));
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

const toolResponse = (count = 1) => ({ usage: { input_tokens: 1, output_tokens: 1 }, content: Array.from({ length: count }, (_, i) => ({ type: "tool_use", id: `delegate${i}`, name: "delegate_specialist", input: { role: "analysis", task: "비교해줘", context: "자료" } })) });
describe("Fable delegates work to Astra", () => {
  it("returns the specialist result to Fable, saves evidence and keeps writes behind approval", async () => {
    f.model.mockResolvedValueOnce(toolResponse()).mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "검토한 최종 답변" }] });
    const data = await (await POST(request())).json();
    expect(f.specialist).toHaveBeenCalledWith({ role: "analysis", task: "비교해줘", context: "자료" }, "me", expect.any(Number));
    expect(data.text).toBe("검토한 최종 답변");
    expect(data.actions).toContainEqual({ name: "delegate_specialist", ok: true, summary: "GPT Astra · 자료 분석 완료" });
    expect(f.model.mock.calls[1][0].messages).toContainEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "delegate0", content: "Astra 분석 결과", is_error: false }] });
    expect(f.insert).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });
  it("caps delegation across the entire turn and sends failures back to Fable", async () => {
    f.specialist.mockResolvedValue({ ok: false, result: "Astra 연결 실패", summary: "Astra 연결 실패" });
    f.model.mockResolvedValueOnce(toolResponse(3)).mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "작업을 나눠 주세요" }] });
    const data = await (await POST(request())).json();
    expect(f.specialist).toHaveBeenCalledTimes(2); expect(data.actions.every((a: { ok: boolean }) => !a.ok)).toBe(true);
    expect(f.model.mock.calls[1][0].messages.at(-1).content.every((r: { is_error: boolean }) => r.is_error)).toBe(true);
    expect(f.insert).not.toHaveBeenCalled();
  });
  it("never lets delegated output bypass confirmation for an actual change", async () => {
    f.model.mockResolvedValueOnce(toolResponse()).mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "write", name: "create_task", input: { title: "검토" } }] });
    const data = await (await POST(request())).json();
    expect(data.pendingActions).toHaveLength(1); expect(data.text).toContain("확인할 초안"); expect(f.read).not.toHaveBeenCalled();
  });
});


describe("MoAI scope boundary", () => {
 it("fails closed before loading conversations when access lookup fails", async () => {
  f.access.mockRejectedValue(new Error("offline"));
  const response=await POST(request());expect(response.status).toBe(503);expect(f.begin).not.toHaveBeenCalled();expect(f.model).not.toHaveBeenCalled();
 });
 it("rejects a model's out-of-scope read and write tools for an operator", async () => {
  f.access.mockResolvedValue({restricted:true,moaiRole:"operator"});
  f.model.mockResolvedValueOnce({usage:{input_tokens:1,output_tokens:1},content:[{type:"tool_use",id:"a",name:"list_tax_invoices",input:{}},{type:"tool_use",id:"b",name:"create_task",input:{title:"x"}}]}).mockResolvedValueOnce({usage:{input_tokens:1,output_tokens:1},content:[{type:"text",text:"권한 범위 밖의 업무예요."}]});
  const result=await (await POST(request())).json();expect(result.ok).toBe(true);expect(f.read).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();expect(f.model.mock.calls[1][0].messages.at(-1).content.every((r:{is_error:boolean})=>r.is_error)).toBe(true);
 });
});


describe("MoAI write confirmation", () => {
  it("offers MoAI creation to an operator and stores one combined confirmation draft", async () => {
    f.access.mockResolvedValue({ restricted: true, moaiRole: "operator" });
    f.model.mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "moai", name: "create_moai_gathering", input: { title: "목요일 스터디", kind: "study", sessions: [{ date: "2026-11-05" }] } }] });
    const result = await (await POST(request())).json();
    expect(result.pendingActions).toHaveLength(1);
    expect(f.prepare).toHaveBeenCalledWith(expect.anything(), "create_moai_gathering", expect.objectContaining({ kind: "study" }), expect.anything());
    expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({ tool_name: "create_moai_gathering", user_id: "me" }));
    expect(f.read).not.toHaveBeenCalled();
    expect(f.model.mock.calls[0][0].tools.map((t: { name: string }) => t.name)).toContain("upsert_moai_sessions");
    expect(result.text).toContain("확인 후 반영");
  });
  it("rejects model-requested MoAI writes when membership is absent, even for an Optify owner", async () => {
    f.access.mockResolvedValue({ restricted: false, moaiRole: null });
    f.model.mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "moai", name: "create_moai_gathering", input: {} }] }).mockResolvedValueOnce({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "권한을 확인해 주세요." }] });
    await POST(request());
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.insert).not.toHaveBeenCalled();
    expect(f.model.mock.calls[0][0].tools.map((t: { name: string }) => t.name)).not.toContain("create_moai_gathering");
  });
});


describe("lecture writes stay behind confirmation and personal workspace access", () => {
  for (const name of ["create_lecture_project", "update_lecture_project", "save_lecture_document"]) {
    it(`prepares ${name} for the full workspace`, async () => {
      f.model.mockResolvedValue({usage:{input_tokens:1,output_tokens:1},content:[{type:"tool_use",id:"lecture",name,input:{title:"강의"}}]});
      const data=await (await POST(request())).json();
      expect(data.pendingActions).toHaveLength(1);expect(f.read).not.toHaveBeenCalled();
      expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({tool_name:name,user_id:"me"}));
      expect(f.model.mock.calls[0][0].tools.some((t:{name:string})=>t.name===name)).toBe(true);
    });
    it(`rejects forged ${name} calls from a MoAI-only operator`, async () => {
      f.access.mockResolvedValue({restricted:true,moaiRole:"operator"});
      f.model.mockResolvedValueOnce({usage:{input_tokens:1,output_tokens:1},content:[{type:"tool_use",id:"lecture",name,input:{}}]}).mockResolvedValueOnce({usage:{input_tokens:1,output_tokens:1},content:[{type:"text",text:"권한을 확인해 주세요."}]});
      await POST(request());expect(f.prepare).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
      expect(f.model.mock.calls[0][0].tools.some((t:{name:string})=>t.name===name)).toBe(false);
    });
  }
});

it("never saves a partially generated document tool call",async()=>{
  f.model.mockResolvedValue({usage:{input_tokens:1,output_tokens:8192},stop_reason:"max_tokens",content:[{type:"tool_use",id:"cut",name:"save_lecture_document",input:{body:"partial"}}]});
  const data=await (await POST(request())).json();expect(data.ok).toBe(false);expect(f.prepare).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();
});
