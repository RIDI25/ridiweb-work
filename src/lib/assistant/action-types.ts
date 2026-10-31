export const READ_TOOLS = ["list_tasks", "list_schedule", "list_tax_invoices", "get_revenue_summary", "search_notes", "read_note"] as const;
export const WRITE_TOOLS = ["create_task", "update_task_status", "set_task_waiting", "create_event", "add_tax_invoice", "add_invoice_payment", "add_lead", "add_ledger_entry"] as const;
export type WriteTool = typeof WRITE_TOOLS[number];
export type ActionStatus = "pending" | "succeeded" | "cancelled" | "failed" | "expired";
export interface ActionDisplay { title: string; fields: { label: string; value: string }[]; note?: string }
export interface PendingAction {
  id: string;
  tool_name: WriteTool;
  display: ActionDisplay;
  status: ActionStatus;
  expires_at: string;
  created_at: string;
  result: { ok: boolean; message: string; record_id?: string } | null;
}
export const ACTION_SELECT = "id, tool_name, display, status, expires_at, created_at, result";
export const isWriteTool = (name: string): name is WriteTool => (WRITE_TOOLS as readonly string[]).includes(name);

export function textValue(raw: unknown, label: string, required = false, max = 2000): string | null {
  if (raw === undefined || raw === null || raw === "") {
    if (required) throw new Error(`${label}을 입력해 주세요.`);
    return null;
  }
  if (typeof raw !== "string" || raw.trim().length > max) throw new Error(`${label} 형식을 확인해 주세요.`);
  const value = raw.trim();
  if (!value && required) throw new Error(`${label}을 입력해 주세요.`);
  return value || null;
}
export function dateValue(raw: unknown, label: string, fallback: string | null = null): string | null {
  const value = textValue(raw, label, false, 10) ?? fallback;
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`${label}은 실제 날짜(YYYY-MM-DD)로 입력해 주세요.`);
  return value;
}
export function moneyValue(raw: unknown, label: string, allowZero = false): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < (allowZero ? 0 : 1) || raw > 1_000_000_000_000) throw new Error(`${label}은 원 단위 정수로 입력해 주세요.`);
  return raw;
}
export function enumValue(raw: unknown, options: readonly string[], fallback?: string): string {
  const value = raw ?? fallback;
  if (typeof value !== "string" || !options.includes(value)) throw new Error("선택한 구분을 확인해 주세요.");
  return value;
}
export function uuidValue(raw: unknown): string {
  if (typeof raw !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) throw new Error("대상 기록을 먼저 조회해 주세요.");
  return raw;
}
export function uniqueMatch(rows: { id: string; name: string }[], query: string, label: string) {
  const normalized = query.trim().toLocaleLowerCase();
  const exact = rows.filter((row) => row.name.toLocaleLowerCase() === normalized);
  const matches = exact.length ? exact : rows.filter((row) => row.name.toLocaleLowerCase().includes(normalized));
  if (matches.length !== 1) throw new Error(matches.length ? `${label}이 여러 명/곳입니다. 정확한 이름을 알려 주세요: ${matches.map((item) => item.name).join(", ")}` : `'${query}'에 해당하는 ${label}을 찾지 못했습니다.`);
  return matches[0];
}
