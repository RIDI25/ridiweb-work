import type { SupabaseClient } from "@supabase/supabase-js";
import { CHECKS, GATHERING_KINDS, MOAI_STATES, TEMPLATE_BODIES, gatheringInput, type Gathering, type MoaiSession } from "@/lib/moai/types";
import { dateValue, enumValue, textValue, uuidValue, type ActionDisplay } from "./action-types";

export const MOAI_WRITE_TOOLS = ["create_moai_gathering", "upsert_moai_sessions"] as const;
export const MOAI_ASSISTANT_TOOLS = ["search_moai", "read_moai", "list_schedule", ...MOAI_WRITE_TOOLS] as const;
export const isMoaiWriteTool = (name: string) => (MOAI_WRITE_TOOLS as readonly string[]).includes(name);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** Omitted IDs append; existing IDs patch. Never replace or delete other sessions. */
export function mergeMoaiSessions(raw: unknown, existing: MoaiSession[] = []) {
  if (!Array.isArray(raw) || raw.length > 60) throw new Error("회차는 60개까지 입력해 주세요.");
  const result = existing.map(session => ({ ...session }));
  const changes: { before?: MoaiSession; after: MoaiSession }[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("회차 정보를 확인해 주세요.");
    const input = value as Record<string, unknown>;
    const id = input.id === undefined ? crypto.randomUUID() : uuidValue(input.id);
    const before = existing.find(session => session.id === id);
    if (input.id !== undefined && !before) throw new Error("수정할 회차를 먼저 조회해 주세요.");
    if (seen.has(id)) throw new Error("같은 회차를 한 번만 지정해 주세요.");
    seen.add(id);
    const date = dateValue(input.date ?? before?.date, "회차 날짜");
    if (!date) throw new Error("추가·수정할 회차의 날짜를 알려 주세요.");
    const after: MoaiSession = {
      id, date,
      title: textValue(input.title ?? before?.title ?? `${result.length + 1}회차`, "회차명", true, 120)!,
      start: textValue(input.start ?? before?.start, "시작 시간", false, 5) || "",
      end: textValue(input.end ?? before?.end, "종료 시간", false, 5) || "",
      location: textValue(input.location ?? before?.location, "장소", false, 300) || "",
    };
    if (before) result[result.findIndex(session => session.id === id)] = after;
    else result.push(after);
    changes.push({ before, after });
  }
  const keys = result.map(s => JSON.stringify([s.title, s.date, s.start, s.end]));
  if (new Set(keys).size !== keys.length) throw new Error("같은 이름·날짜·시간의 회차가 이미 있어요. 기존 회차를 조회해 수정해 주세요.");
  return { sessions: result, changes };
}

const sessionLabel = (s: MoaiSession) => `${s.title} · ${s.date} · ${s.start ? `${s.start}–${s.end}` : "시간 미정"} · ${s.location || "장소 미정"}`;

export async function prepareMoaiAction(db: SupabaseClient, name: string, input: Record<string, unknown>, userId: string) {
  const { data: membership, error: memberError } = await db.from("moai_members").select("role").eq("user_id", userId).maybeSingle();
  if (memberError || !membership || !["reviewer", "operator"].includes(membership.role)) throw new Error("모아이 운영 권한을 확인해 주세요.");
  const fields: ActionDisplay["fields"] = [];
  if (name === "create_moai_gathering") {
    const title = textValue(input.title, "모임명", true, 200)!;
    const kind = enumValue(input.kind, Object.keys(GATHERING_KINDS)) as keyof typeof GATHERING_KINDS;
    const period = textValue(input.period, "운영 월", false, 7) || "";
    const { data: duplicates, error: duplicateError } = await db.from("moai_gatherings").select("id").eq("archived", false).eq("kind", kind).eq("period", period).ilike("title", escapeLike(title)).limit(1);
    if (duplicateError) throw new Error("기존 모임을 확인하지 못했어요. 다시 요청해 주세요.");
    if (duplicates?.length) throw new Error("같은 이름·운영 월의 모임이 이미 있어요. 조회 후 기존 모임에 회차를 추가해 주세요.");
    const { data: templates, error } = await db.from("moai_templates").select("kind,body");
    if (error) throw new Error("모아이 공통 양식을 불러오지 못했어요.");
    const { sessions } = mergeMoaiSessions(input.sessions ?? []);
    const values = gatheringInput({
      ...TEMPLATE_BODIES, ...Object.fromEntries((templates || []).map(t => [t.kind, t.body])),
      title, kind, period, theme: input.theme ?? "", capacity: input.capacity ?? 0, fee: input.fee ?? 0,
      sessions, checklist: CHECKS.map((title, i) => ({ id: `check-${i}`, title, done: false })),
    });
    fields.push({ label: "모임", value: title }, { label: "구분", value: GATHERING_KINDS[kind] }, { label: "운영 월", value: period || "미정" }, { label: "주제", value: values.theme || "미정" }, { label: "정원", value: input.capacity === undefined ? "미정 (제한 없음으로 저장)" : `${values.capacity}명${values.capacity === 0 ? " (제한 없음)" : ""}` }, { label: "참가비", value: input.fee === undefined ? "미정 (0원으로 저장, 추후 설정)" : `${values.fee.toLocaleString("ko-KR")}원` });
    fields.push({ label: "회차 (한국)", value: sessions.map(sessionLabel).join("\n") || "아직 없음" });
    return { payload: { values }, display: { title: "모아이 모임·회차 생성", fields, note: "모임과 회차를 함께 저장하고 통합 캘린더에 가안으로 표시합니다. 공통 양식과 준비 목록을 포함하며, 기획 최종 승인은 별도입니다." } satisfies ActionDisplay };
  }

  const id = uuidValue(input.gathering_id);
  const { data, error } = await db.from("moai_gatherings").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("모임을 먼저 조회해 주세요.");
  const gathering = data as Gathering;
  if (gathering.archived || gathering.state === "cancelled") throw new Error("보관·취소된 모임은 모아이 화면에서 복원한 뒤 변경해 주세요.");
  const { sessions, changes } = mergeMoaiSessions(input.sessions, gathering.sessions);
  if (!changes.length) throw new Error("추가·수정할 회차를 알려 주세요.");
  // Reuse screen validation, including time order and retained session notes.
  const values = gatheringInput({ ...gathering, sessions });
  fields.push({ label: "모임", value: gathering.title }, { label: "현재 상태", value: MOAI_STATES[gathering.state] });
  for (const change of changes) fields.push({ label: change.before ? "회차 변경" : "회차 추가", value: change.before ? `${sessionLabel(change.before)}\n→ ${sessionLabel(change.after)}` : sessionLabel(change.after) });
  return { payload: { gathering_id: id, expected_version: gathering.version, sessions: values.sessions }, display: { title: "모아이 회차 일정 변경", fields, note: "표시된 회차만 추가·수정합니다. 다른 회차·명단·출석·문서는 유지하고 통합 캘린더에도 반영합니다. 검토 중이거나 승인된 모임은 기획 중으로 돌아가 재검토가 필요합니다." } satisfies ActionDisplay };
}
