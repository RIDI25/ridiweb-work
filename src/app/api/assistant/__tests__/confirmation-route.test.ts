import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }), rpc: mocks.rpc }) }));
import { POST } from "../actions/route";
const id = "10000000-0000-4000-8000-000000000001";
const request = (body: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/assistant/actions", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id } } }); mocks.profile.mockResolvedValue({ data: { id } }); mocks.rpc.mockResolvedValue({ data: { id, status: "succeeded" }, error: null }); });
describe("confirmation route", () => {
  it("uses only stored request ID and decision, ignoring forged payload", async () => {
    const response = await POST(request({ id, decision: "confirm", payload: { amount: 999999 }, tool_name: "add_invoice_payment", user_id: "other" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_chat_assistant_action", { request_id: id, decision: "confirm" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("requires both login and team membership", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(request({ id, decision: "confirm" }))).status).toBe(401);
    mocks.profile.mockResolvedValueOnce({ data: null });
    expect((await POST(request({ id, decision: "confirm" }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid decisions, IDs, JSON and cross-origin requests", async () => {
    for (const body of [{ id, decision: "execute" }, { id: "bad", decision: "confirm" }, null]) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request({ id, decision: "confirm" }, "https://untrusted.example"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not report success when the database cannot confirm a result", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "connection lost" } });
    const response = await POST(request({ id, decision: "confirm" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("결과를 확인하지 못했습니다");
  });
});
