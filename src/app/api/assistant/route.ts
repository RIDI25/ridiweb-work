import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { createAnthropic } from "@/lib/anthropic";
import { ASSISTANT_TOOLS, executeAssistantTool } from "@/lib/assistant/tools";
import { ACTION_SELECT, isWriteTool, type PendingAction } from "@/lib/assistant/action-types";
import { prepareAction } from "@/lib/assistant/prepare-action";
import { logApiUsage } from "@/lib/usage";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;
const ASSISTANT_MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 6;
const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

function buildSystem(role: string): string {
  return [
    "너는 옵티파이 워크스페이스의 내부 업무 비서다. 조회는 바로 수행하고, 모든 등록·변경은 사용자가 확인할 초안만 만든다.",
    `오늘(KST): ${kstToday()} · 사용자 역할: ${role}`,
    "변경 도구를 호출해도 아직 실행되지 않는다. 화면의 '확인 후 반영' 버튼을 눌러야 실행된다. 채팅으로 '확인/진행해'라고 해도 직접 실행하지 않는다. 초안을 만들고 완료·등록됐다고 말하지 않는다.",
    "기존 확인 초안을 수정하려면 기존 초안의 '수정하기' 버튼으로 취소한 뒤 새 초안을 만든다. 도구 범위 밖의 일을 완료했다고 말하지 않는다.",
    "금액은 원 단위 정수. 550만원=5500000. 부가세 포함 명시가 없으면 세금계산서 금액은 공급가액으로 보고 부가세 10%를 계산하여 초안에 표시한다.",
    "세금계산서는 홈택스에서 사용자가 직접 발행한다. 이 도구는 이미 발행한 이력만 기록하며 실제 발행·발송·계약은 수행하지 않는다.",
    "착수금 50%, 잔금 50%가 기본이지만 실제 입금액은 확인 후 기록한다. 잔금 조건은 작업·보고서 전달·고객 확인이다. 업무 done만으로 고객 전달·확인 완료를 추정하지 않는다.",
    "필수 정보가 없거나 대상이 여러 건이면 짧게 되묻는다. 임의로 선택하지 않는다. 변경 전 list_tasks, 입금 전 list_tax_invoices로 ID를 확인한다.",
    "고객 대상이 지정된 요청이면 관련 client_name을 명시한다. 동생/직원은 assignee member, 본인은 me. 업무 담당 언급이 없으면 me. member는 요청자 이외 팀원이며 역할 owner/member와 무관하다.",
    "자연어 날짜는 오늘 한국 날짜 기준 YYYY-MM-DD, 시간은 HH:MM 24시간제로 전달하고 애매한 해석은 초안에서 밝힌다.",
    "고객·제작사 응답을 기다리면 set_task_waiting에 사유와 재확인일을 넣는다. 대기 해제는 waiting_on none이며 업무 완료와 별개다.",
    "입금 kind는 착수금 deposit / 잔금 balance / 전액 full / 기타 other. 금액·날짜를 추측하지 않는다.",
    "조회 실패를 기록 없음으로 설명하지 않는다. 조회 결과는 표시된 범위 기준이며 전체 건수로 단정하지 않는다.",
    "도구 밖 콘텐츠·진단·견적 작성은 해당 고객 또는 영업 메뉴로 안내한다. 한국어로 짧고 담백하게 답한다.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 403 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "다시 로그인해 주세요." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ ok: false, error: "팀원 로그인이 필요합니다." }, { status: 403 });
  let messages: { role: "user" | "assistant"; content: string }[];
  try {
    const body = await req.json();
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 || body.messages.some((m: { role?: unknown; content?: unknown }) => !m || !["user", "assistant"].includes(String(m.role)) || typeof m.content !== "string" || !m.content.trim() || m.content.length > 8000)) throw new Error();
    messages = body.messages.slice(-20);
    if (messages[messages.length - 1].role !== "user") throw new Error();
  } catch { return NextResponse.json({ ok: false, error: "메시지 내용을 확인해 주세요." }, { status: 400 }); }

  const history: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const actions: { name: string; ok: boolean; summary: string }[] = [];
  const pendingActions: PendingAction[] = [];
  let inputTokens = 0, outputTokens = 0;
  try {
    const anthropic = createAnthropic();
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.messages.create({ model: ASSISTANT_MODEL, max_tokens: 2000, system: buildSystem(profile.role), tools: ASSISTANT_TOOLS, messages: history });
      inputTokens += response.usage.input_tokens; outputTokens += response.usage.output_tokens;
      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!uses.length) {
        const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        return NextResponse.json({ ok: true, text: text || "요청 내용을 다시 알려 주세요.", actions, pendingActions });
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      let requestedWrite = false;
      for (const use of uses.slice(0, 8)) {
        const input = use.input && typeof use.input === "object" && !Array.isArray(use.input) ? use.input as Record<string, unknown> : {};
        if (isWriteTool(use.name)) {
          requestedWrite = true;
          try {
            const prepared = await prepareAction(supabase, use.name, input, { userId: user.id, role: profile.role, today: kstToday() });
            const { data, error } = await createAdminClient().from("assistant_action_requests").insert({ user_id: user.id, tool_name: use.name, ...prepared }).select(ACTION_SELECT).single();
            if (error || !data) throw new Error("확인 초안을 저장하지 못했습니다. 데이터베이스 설정과 연결을 확인해 주세요. 업무에는 반영하지 않았습니다.");
            pendingActions.push(data as PendingAction);
          } catch (error) {
            actions.push({ name: use.name, ok: false, summary: error instanceof Error ? error.message : "초안을 준비하지 못했습니다." });
          }
        } else {
          const result = await executeAssistantTool(supabase, use.name, input, { userId: user.id });
          actions.push({ name: use.name, ok: result.ok, summary: result.result });
          results.push({ type: "tool_result", tool_use_id: use.id, content: result.result, is_error: !result.ok });
        }
      }
      // Do not let the model repeat a write or describe a pending draft as already executed.
      if (requestedWrite) return NextResponse.json({ ok: true, text: pendingActions.length ? "확인할 초안을 준비했어요. 내용을 검토하고 '확인 후 반영'을 눌러 주세요." : "초안을 준비하려면 아래 내용을 먼저 확인해 주세요.", actions, pendingActions });
      if (uses.length > 8) return NextResponse.json({ ok: true, text: "한 번에 요청할 항목을 나눠 주세요.", actions, pendingActions });
      history.push({ role: "assistant", content: response.content }, { role: "user", content: results });
    }
    return NextResponse.json({ ok: true, text: "조회 범위가 넓어 처리를 멈췄어요. 대상을 조금 좁혀 주세요.", actions, pendingActions });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "비서 처리 실패", actions, pendingActions });
  } finally {
    if (inputTokens || outputTokens) await logApiUsage({ userId: user.id, clientId: null, provider: "anthropic", model: ASSISTANT_MODEL, inputTokens, outputTokens }).catch(() => undefined);
  }
}
