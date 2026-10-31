import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const usage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/usage", () => ({ logApiUsage: usage }));
import { runSpecialist } from "../specialist";
const input = { role: "analysis", task: "수치를 비교해줘", context: "A 10, B 20" };
const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "test-only"); vi.stubGlobal("fetch", fetchMock); usage.mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Astra specialist boundary", () => {
  it("uses Responses with fixed Astra, bounded context, no tools and no provider storage", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "B는 A의 두 배" }] }], usage: { input_tokens: 10, output_tokens: 20 } }));
    const result = await runSpecialist(input, "owner");
    expect(result.ok).toBe(true); expect(result.result).toContain("두 배");
    const [url, options] = fetchMock.mock.calls[0]; const body = JSON.parse(options.body);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({ model: "gpt-6-astra", reasoning: { effort: "medium" }, store: false, max_output_tokens: 8192 });
    expect(body.tools).toBeUndefined(); expect(body.temperature).toBeUndefined();
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", provider: "openai", model: "gpt-6-astra", inputTokens: 10, outputTokens: 20 }));
  });
  it("rejects unknown roles and oversized or malformed context before calling the provider", async () => {
    for (const bad of [{ ...input, role: "toString" }, { ...input, role: "administrator" }, { ...input, context: "x".repeat(24001) }, { ...input, task: " " }, { ...input, context: {} }]) expect((await runSpecialist(bad, "owner")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports missing keys and provider errors without fallback or exposing response bodies", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); expect((await runSpecialist(input, "owner")).ok).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_API_KEY", "test-only"); fetchMock.mockResolvedValue(Response.json({ error: { message: "sensitive provider details" } }, { status: 403 }));
    const result = await runSpecialist(input, "owner"); expect(result.ok).toBe(false); expect(result.result).not.toContain("sensitive"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not treat refusals or incomplete output as success, but records consumed tokens", async () => {
    for (const data of [{ status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }] }, { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }]) {
      fetchMock.mockResolvedValue(Response.json({ ...data, usage: { input_tokens: 10, output_tokens: 5 } }));
      expect((await runSpecialist(input, "owner")).ok).toBe(false);
    }
    expect(usage).toHaveBeenCalledTimes(2);
  });
  it("handles timeouts without retrying a different model", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect((await runSpecialist(input, "owner")).result).toContain("시간이 초과"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
