import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateValue, moneyValue, uniqueMatch } from "../assistant/action-types";
import { prepareAction, resolvePerson } from "../assistant/prepare-action";
import { executeAssistantTool } from "../assistant/tools";

const me = "10000000-0000-4000-8000-000000000001";
const client = "10000000-0000-4000-8000-000000000002";
const sibling = "10000000-0000-4000-8000-000000000003";
function database(rows: Record<string, unknown[]>): SupabaseClient {
  return { from(table: string) { const result = { data: rows[table] ?? [], error: null, count: rows[table]?.length ?? 0 };
    const query = { select() { return query; }, ilike() { return query; }, limit() { return query; }, eq() { return query; }, single() { return Promise.resolve({ data: result.data[0], error: null }); }, then: Promise.resolve(result).then.bind(Promise.resolve(result)) };
    return query;
  } } as unknown as SupabaseClient;
}
const ctx = { userId: me, role: "owner", today: "2026-11-01" };
describe("assistant confirmation preparation", () => {
  it("rejects invalid calendar dates and unsafe/coerced money", () => {
    expect(() => dateValue("2026-02-30", "날짜")).toThrow();
    expect(() => dateValue("2026-11-01T12:00", "날짜")).toThrow();
    expect(dateValue("2028-02-29", "날짜")).toBe("2028-02-29");
    for (const value of ["100", -1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => moneyValue(value, "금액")).toThrow();
  });
  it("prefers an exact name and rejects ambiguous or missing names", () => {
    const rows = [{ id: "1", name: "가온" }, { id: "2", name: "가온치과" }];
    expect(uniqueMatch(rows, "가온", "고객").id).toBe("1");
    expect(() => uniqueMatch(rows, "가", "고객")).toThrow(/여러/);
    expect(() => uniqueMatch(rows, "없는 고객", "고객")).toThrow(/찾지/);
    expect(() => uniqueMatch([...rows, rows[0]], "가온", "고객")).toThrow(/여러/);
  });
  it("resolves sibling as the other team member even when both are owners", async () => {
    const db = database({ profiles: [{ id: me, name: "유리", role: "owner" }, { id: sibling, name: "동생", role: "owner" }] });
    expect((await resolvePerson(db, me, "member")).id).toBe(sibling);
    await expect(resolvePerson(database({ profiles: [{ id: me, name: "나" }, { id: sibling, name: "가" }, { id: client, name: "나나" }] }), me, "member")).rejects.toThrow(/이름/);
  });
  it("freezes task identity and defaults in the preview without writing", async () => {
    const result = await prepareAction(database({ clients: [{ id: client, name: "가온" }], profiles: [{ id: me, name: "유리" }] }), "create_task", { title: "  점검  ", client_name: "가온" }, ctx);
    expect(result.payload).toMatchObject({ title: "점검", client_id: client, assignee_id: me, status: "todo", due_date: null, priority: "normal" });
    expect(result.display.fields).toContainEqual({ label: "고객", value: "가온" });
    expect(result.display.fields).toContainEqual({ label: "담당", value: "유리" });
  });
  it("does not silently create an unlinked task when a named customer is missing", async () => {
    await expect(prepareAction(database({ clients: [] }), "create_task", { title: "점검", client_name: "잘못된 고객" }, ctx)).rejects.toThrow(/찾지/);
  });
  it("shows VAT and total and distinguishes invoice history from actual issue", async () => {
    const result = await prepareAction(database({}), "add_tax_invoice", { counterparty: "가온", supply_amount: 1000000 }, ctx);
    expect(result.payload).toMatchObject({ issue_date: "2026-11-01", supply_amount: 1000000, vat_amount: 100000, total_amount: 1100000 });
    expect(result.display.fields).toContainEqual({ label: "합계", value: "1,100,000원" });
    expect(result.display.note).toContain("발행하지 않습니다");
    await expect(prepareAction(database({}), "add_tax_invoice", { counterparty: "가온", supply_amount: 1 }, { ...ctx, role: "member" })).rejects.toThrow(/owner/);
  });
  it("rejects overpayment and retains deposit/balance distinction", async () => {
    const db = database({ tax_invoices: [{ id: client, counterparty: "가온", status: "issued", total_amount: 1000 }], invoice_payments: [{ amount: 500 }] });
    await expect(prepareAction(db, "add_invoice_payment", { invoice_id: client, amount: 501 }, ctx)).rejects.toThrow(/미수금/);
    const result = await prepareAction(db, "add_invoice_payment", { invoice_id: client, amount: 500, kind: "balance" }, ctx);
    expect(result.payload.kind).toBe("balance");
    expect(result.display.fields).toContainEqual({ label: "등록 후 미수금", value: "0원" });
  });
  it("requires waiting reasons and freezes the task version", async () => {
    const db = database({ tasks: [{ id: client, title: "점검", status: "review", waiting_on: "none", updated_at: "2026-11-01T00:00:00Z", client_id: null }] });
    await expect(prepareAction(db, "set_task_waiting", { task_id: client, waiting_on: "vendor" }, ctx)).rejects.toThrow(/사유/);
    const result = await prepareAction(db, "set_task_waiting", { task_id: client, waiting_on: "vendor", waiting_reason: "일정 회신 대기", followup_date: "2026-11-04" }, ctx);
    expect(result.payload.expected_updated_at).toBe("2026-11-01T00:00:00Z");
    expect(result.payload).not.toHaveProperty("status");
  });
  it("legacy executor cannot write any tool or unknown name", async () => {
    const db = { from() { throw new Error("must not access database"); } } as unknown as SupabaseClient;
    for (const name of ["create_task", "add_invoice_payment", "update_task_status", "set_task_waiting", "unknown"]) {
      expect(await executeAssistantTool(db, name, {}, { userId: me })).toEqual({ ok: false, result: "변경은 확인 초안을 통해서만 실행할 수 있습니다." });
    }
  });
});
