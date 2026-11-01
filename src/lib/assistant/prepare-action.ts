import { isLectureWriteTool, prepareLectureAction } from "./lecture-actions";
import { isMoaiWriteTool, prepareMoaiAction } from "./moai-actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, taskStatusLabel, taskTypeLabel, taskPriorityDef } from "@/lib/tasks";
import { EVENT_TYPES, eventTypeLabel } from "@/lib/schedule";
import { ENTRY_TYPES, PAYMENT_METHODS, LEDGER_CATEGORIES, entryTypeLabel, paymentMethodLabel, ledgerCategoryLabel } from "@/lib/ledger";
import { WAITING_OPTIONS, waitingLabel } from "@/lib/task-waiting";
import { dateValue, enumValue, moneyValue, textValue, uniqueMatch, uuidValue, type ActionDisplay, type WriteTool } from "./action-types";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const channelLabel = (value: string) => ({ direct: "직접", referral: "소개", partner: "파트너" })[value] ?? value;

export async function resolvePerson(db: SupabaseClient, userId: string, raw: unknown) {
  const value = textValue(raw, "담당자", false, 100);
  if (!value) return { id: null, name: "미지정" };
  const { data, error, count } = await db.from("profiles").select("id, name", { count: "exact" });
  if (error || !data || (count ?? 0) > data.length) throw new Error("담당자 정보를 불러오지 못했습니다.");
  if (value === "me") {
    const me = data.find((item) => item.id === userId);
    if (!me) throw new Error("내 프로필을 찾지 못했습니다.");
    return me as { id: string; name: string };
  }
  if (value === "member") {
    const others = data.filter((item) => item.id !== userId);
    if (others.length !== 1) throw new Error("업무를 맡길 팀원의 이름을 알려 주세요.");
    return others[0] as { id: string; name: string };
  }
  return uniqueMatch(data as { id: string; name: string }[], value, "팀원");
}

export async function resolveCustomer(db: SupabaseClient, raw: unknown) {
  const value = textValue(raw, "고객명", false, 200);
  if (!value) return { id: null, name: "고객 연결 없음" };
  // Search literally: % and _ in company names must not broaden the match.
  const escaped = value.replace(/[\\%_]/g, "\\$&");
  const { data, error, count } = await db.from("clients").select("id, name", { count: "exact" }).ilike("name", `%${escaped}%`).limit(50);
  if (error || !data) throw new Error("고객 정보를 불러오지 못했습니다.");
  if ((count ?? 0) > 50) throw new Error("고객명이 너무 넓습니다. 정확한 고객명을 알려 주세요.");
  return uniqueMatch(data as { id: string; name: string }[], value, "고객");
}

/** Resolve and freeze every target/default before showing the approval card. Never writes business data. */
export async function prepareAction(db: SupabaseClient, name: WriteTool, input: Record<string, unknown>, ctx: { userId: string; role: string; today: string }): Promise<{ payload: Record<string, unknown>; display: ActionDisplay }> {
  if (isLectureWriteTool(name)) return prepareLectureAction(db, name, input, ctx.userId);
  if (isMoaiWriteTool(name)) return prepareMoaiAction(db, name, input, ctx.userId);
  if (["add_tax_invoice", "add_invoice_payment", "add_lead"].includes(name) && ctx.role !== "owner") throw new Error("이 기록은 owner만 등록할 수 있습니다.");
  const fields: ActionDisplay["fields"] = [];
  const field = (label: string, value: unknown) => fields.push({ label, value: value === null || value === undefined || value === "" ? "미정" : String(value) });
  const memo = textValue(input.memo, "메모");
  let payload: Record<string, unknown> = { memo };
  let title = "";
  let note = "확인 버튼을 누르면 워크스페이스에 반영합니다.";
  if (name === "create_task" || name === "create_event") {
    const client = await resolveCustomer(db, input.client_name);
    const person = await resolvePerson(db, ctx.userId, input.assignee ?? (name === "create_task" ? "me" : null));
    payload = { ...payload, title: textValue(input.title, "제목", true, 300), client_id: client.id, assignee_id: person.id };
    field("제목", payload.title); field("고객", client.name); field("담당", person.name);
    if (name === "create_task") {
      title = "업무 등록";
      Object.assign(payload, { due_date: dateValue(input.due_date, "마감일"), status: "todo", task_type: enumValue(input.task_type, TASK_TYPES.map((x) => x.key), "ops"), priority: enumValue(input.priority, TASK_PRIORITIES.map((x) => x.key), "normal") });
      field("마감", payload.due_date); field("유형", taskTypeLabel(String(payload.task_type))); field("우선순위", taskPriorityDef(String(payload.priority))?.label); field("상태", "할 일");
    } else {
      title = "일정 등록";
      const time = textValue(input.event_time, "시간", false, 5);
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("시간은 HH:MM 형식으로 알려 주세요.");
      const date = dateValue(input.event_date, "일정 날짜");
      if (!date) throw new Error("일정 날짜가 필요합니다.");
      Object.assign(payload, { event_date: date, event_time: time, event_type: enumValue(input.event_type, EVENT_TYPES.map((x) => x.key), "meeting") });
      field("날짜", date); field("시간 (한국)", time); field("유형", eventTypeLabel(String(payload.event_type)));
    }
  } else if (name === "update_task_status" || name === "set_task_waiting") {
    const id = uuidValue(input.task_id);
    const { data: task, error } = await db.from("tasks").select("*").eq("id", id).single();
    if (error || !task) throw new Error("대상 업무를 찾지 못했습니다. 업무 목록을 다시 확인해 주세요.");
    const { data: client, error: clientError } = task.client_id ? await db.from("clients").select("name").eq("id", task.client_id).single() : { data: null, error: null };
    if (clientError) throw new Error("고객 정보를 확인하지 못했습니다.");
    payload = { task_id: id, expected_updated_at: task.updated_at };
    field("업무", task.title); field("고객", client?.name ?? "옵티파이 내부");
    if (name === "update_task_status") {
      title = "업무 상태 변경";
      payload.status = enumValue(input.status, TASK_STATUSES.map((x) => x.key));
      field("변경", `${taskStatusLabel(task.status)} → ${taskStatusLabel(String(payload.status))}`);
      if (payload.status === "done") note = "업무 완료 시 대기도 해제합니다. 고객 보고·전달·확인 완료를 뜻하지 않습니다.";
    } else {
      if (task.status === "done") throw new Error("완료된 업무에는 대기를 등록할 수 없습니다. 업무 상태를 먼저 변경해 주세요.");
      if (task.waiting_on === undefined) throw new Error("대기 기록 기능의 데이터베이스 설정이 필요합니다.");
      payload.waiting_on = enumValue(input.waiting_on, WAITING_OPTIONS.map((x) => x.key));
      payload.waiting_reason = payload.waiting_on === "none" ? null : textValue(input.waiting_reason, "대기 사유", true);
      payload.followup_date = payload.waiting_on === "none" ? null : dateValue(input.followup_date, "재확인일");
      title = payload.waiting_on === "none" ? "대기 해제" : "업무 대기 기록";
      field("현재 대기", waitingLabel(task.waiting_on)); field("변경할 대기", waitingLabel(String(payload.waiting_on)));
      if (payload.waiting_on !== "none") { field("사유", payload.waiting_reason); field("재확인일", payload.followup_date); }
      note = "대기 상태만 변경합니다. 업무 진행 상태는 유지합니다.";
    }
  } else if (name === "add_tax_invoice") {
    title = "세금계산서 발행 이력 등록";
    const supply = moneyValue(input.supply_amount, "공급가액");
    const vat = moneyValue(input.vat_amount ?? Math.round(supply * 0.1), "부가세", true);
    payload = { ...payload, counterparty: textValue(input.counterparty, "거래처명", true, 200), issue_date: dateValue(input.issue_date, "발행일", ctx.today), end_client_name: textValue(input.end_client_name, "실고객명", false, 200), description: textValue(input.description, "적요"), supply_amount: supply, vat_amount: vat, total_amount: supply + vat, deal_channel: enumValue(input.deal_channel, ["direct", "referral", "partner"], "direct") };
    field("거래처", payload.counterparty); field("발행일", payload.issue_date); field("실고객", payload.end_client_name); field("적요", payload.description);
    field("공급가액", won(supply)); field("부가세", won(vat)); field("합계", won(supply + vat)); field("거래 구분", channelLabel(String(payload.deal_channel)));
    note = "홈택스에서 직접 발행한 내역만 기록합니다. 이 버튼으로 세금계산서를 발행하지 않습니다.";
  } else if (name === "add_invoice_payment") {
    title = "입금 기록";
    const id = uuidValue(input.invoice_id);
    const { data: invoice, error } = await db.from("tax_invoices").select("*").eq("id", id).single();
    const { data: payments, error: paymentError, count } = await db.from("invoice_payments").select("amount", { count: "exact" }).eq("invoice_id", id);
    if (error || !invoice || paymentError || (count ?? 0) > (payments?.length ?? 0)) throw new Error("인보이스와 입금 기록을 다시 조회해 주세요.");
    if (invoice.status === "cancelled") throw new Error("취소된 인보이스에는 입금을 등록할 수 없습니다.");
    const paid = (payments ?? []).reduce((sum, item) => sum + Number(item.amount), 0);
    const amount = moneyValue(input.amount, "입금액");
    if (amount > Number(invoice.total_amount) - paid) throw new Error("입금액이 남은 미수금보다 큽니다. 금액과 대상 인보이스를 확인해 주세요.");
    payload = { ...payload, invoice_id: id, amount, paid_date: dateValue(input.paid_date, "입금일", ctx.today), kind: enumValue(input.kind, ["deposit", "balance", "full", "other"], "other"), expected_invoice: invoice, expected_paid: paid };
    field("거래처", invoice.counterparty); field("대상 발행일", invoice.issue_date); field("실고객", invoice.end_client_name); field("적요", invoice.description); field("인보이스 합계", won(Number(invoice.total_amount)));
    field("입금일", payload.paid_date); field("입금액", won(amount)); field("구분", ({ deposit: "착수금", balance: "잔금", full: "전액", other: "기타" })[String(payload.kind) as "other"]);
    field("등록 후 미수금", won(Number(invoice.total_amount) - paid - amount));
    note = "실제 입금 내역을 기록합니다. 잔금 기록은 보고서 전달·고객 확인 완료와 별개입니다.";
  } else if (name === "add_lead") {
    title = "영업 리드 등록";
    payload.company_name = textValue(input.company_name, "업체명", true, 200); field("업체명", payload.company_name);
    for (const [key, label] of Object.entries({ contact_name: "담당자", phone: "연락처", email: "이메일", industry: "업종", region: "지역", source: "유입경로", partner_name: "파트너·소개자" })) { payload[key] = textValue(input[key], label, false, 300); field(label, payload[key]); }
    payload.deal_channel = enumValue(input.deal_channel, ["direct", "referral", "partner"], "direct");
    payload.next_followup = dateValue(input.next_followup, "재확인일");
    field("거래 구분", channelLabel(String(payload.deal_channel))); field("재확인일", payload.next_followup); field("단계", "문의");
  } else if (name === "add_ledger_entry") {
    title = "장부 기입";
    payload = { ...payload, amount: moneyValue(input.amount, "금액"), entry_date: dateValue(input.entry_date, "일자", ctx.today), entry_type: enumValue(input.entry_type, ENTRY_TYPES.map((x) => x.key), "expense"), payment_method: enumValue(input.payment_method, PAYMENT_METHODS.map((x) => x.key), "card"), category: enumValue(input.category, LEDGER_CATEGORIES.map((x) => x.key), "etc"), counterparty: textValue(input.counterparty, "거래처", false, 200), description: textValue(input.description, "적요") };
    const category = LEDGER_CATEGORIES.find((x) => x.key === payload.category)!;
    if (category.type !== "both" && category.type !== payload.entry_type) throw new Error("입금·지출 구분과 장부 분류가 맞지 않습니다.");
    field("일자", payload.entry_date); field("구분", entryTypeLabel(String(payload.entry_type))); field("금액", won(Number(payload.amount))); field("결제수단", paymentMethodLabel(String(payload.payment_method))); field("거래처", payload.counterparty); field("적요", payload.description); field("분류", ledgerCategoryLabel(String(payload.category)));
  }
  if (memo && "memo" in payload) field("메모", memo);
  return { payload, display: { title, fields, note } satisfies ActionDisplay };
}
