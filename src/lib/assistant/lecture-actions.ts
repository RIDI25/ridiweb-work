import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceAccess } from "@/lib/workspace-access";
import { documentInput, documentTemplate, emptyProject, KINDS, ORIGINS, projectInput, STAGES, type LectureDocument, type LectureProject, type LectureSession, type ChecklistItem } from "@/lib/lectures/types";
import { textValue, uuidValue, type ActionDisplay } from "./action-types";

export const LECTURE_WRITE_TOOLS = ["create_lecture_project", "update_lecture_project", "save_lecture_document"] as const;
export const isLectureWriteTool = (name: string) => (LECTURE_WRITE_TOOLS as readonly string[]).includes(name);
const sessionProperties = { id: { type: "string", description: "기존 일정 수정 시 조회한 ID. 새 일정은 생략" }, title: { type: "string" }, date: { type: "string", description: "한국 날짜 YYYY-MM-DD, 미정은 빈 문자열" }, start: { type: "string", description: "HH:MM, 종료와 함께 입력" }, end: { type: "string" }, location: { type: "string" }, confirmed: { type: "boolean", description: "사용자가 확정한 일정만 true, 기본 false" }, kind: { type: "string", enum: ["lecture", "prep", "travel"] } };
const projectProperties = {
  title: { type: "string" }, origin: { type: "string", enum: Object.keys(ORIGINS) }, stage: { type: "string", enum: Object.keys(STAGES) },
  organization: { type: "string" }, contact: { type: "string" }, audience: { type: "string" }, brief: { type: "string" }, fee: { type: "string", description: "강의료·지급 조건. 미정이면 생략" },
  next_action: { type: "string" }, next_action_date: { type: ["string", "null"], description: "YYYY-MM-DD 또는 null로 해제" },
  sessions: { type: "array", maxItems: 80, items: { type: "object", properties: sessionProperties, additionalProperties: false } },
  checklist: { type: "array", maxItems: 80, items: { type: "object", properties: { id: { type: "string", description: "기존 항목 수정 시 조회한 ID. 새 항목은 생략" }, title: { type: "string" }, done: { type: "boolean" } }, additionalProperties: false } },
  history_verified: { type: "boolean", description: "완료 후 사용자가 확인한 실제 이력만 true" }, archived: { type: "boolean", description: "보관 true, 복원 false. 영구 삭제하지 않음" },
};
const documentProperties = { kind: { type: "string", enum: Object.keys(KINDS) }, title: { type: "string" }, body: { type: "string", description: "저장할 전체 본문. 일부만 보내면 나머지는 사라지므로 기존 문서를 끝까지 읽고 작성" } };
export const LECTURE_TOOLS: Anthropic.Tool[] = [
  { name: "create_lecture_project", description: "강의 제안·의뢰와 초기 일정, 준비 목록, 문서를 하나의 확인 초안으로 만든다. 먼저 검색하여 중복을 확인한다. 사용자가 확인하면 함께 저장되고 통합 캘린더에 표시된다. 새 강의와 문서 생성은 이 도구 하나에 묶는다.", input_schema: { type: "object", properties: { ...projectProperties, documents: { type: "array", maxItems: 5, items: { type: "object", properties: documentProperties, required: ["kind", "title"], additionalProperties: false } } }, required: ["title", "origin"], additionalProperties: false } },
  { name: "update_lecture_project", description: "조회한 강의 정보·진행 단계·일정·준비 항목·할 일·검증된 이력·보관/복원을 변경하는 확인 초안. 보낸 필드만 수정하고 나머지는 보존한다. 일정/준비 항목은 ID로 병합, 새 항목은 ID 생략. 제외는 명시적인 remove_*_ids로만 가능. 같은 강의 변경은 한 호출에 묶는다.", input_schema: { type: "object", properties: { project_id: { type: "string" }, expected_version: { type: "integer", description: "read_lecture로 읽은 현재 강의 버전" }, ...projectProperties, remove_session_ids: { type: "array", items: { type: "string" } }, remove_checklist_ids: { type: "array", items: { type: "string" } } }, required: ["project_id", "expected_version"], additionalProperties: false } },
  { name: "save_lecture_document", description: "제안서·커리큘럼·강사 소개·교안·결과 기록을 생성/수정/보관/복원/확정하는 확인 초안. 기존 수정은 document_id, 새 문서는 kind,title과 project_id(개인 기본 자료는 null). 기존 문서를 끝까지 읽은 뒤 변경할 전체 body를 보낸다. 생략한 값은 보존. source_document_id로 내 문서를 복사하거나, 기존 문서에 restore_revision_id로 이전 버전을 복원할 수 있다. 새 문서와 내용 수정·복원은 작성 중으로 저장된다. 확정은 저장된 본문을 검토한 후 status final만 별도로 지정한다. 외부 발송은 하지 않는다.", input_schema: { type: "object", properties: { document_id: { type: "string" }, expected_version: { type: "integer", description: "기존 문서 수정 시 read_lecture로 읽은 현재 버전, 필수" }, project_id: { type: ["string", "null"] }, ...documentProperties, status: { type: "string", enum: ["draft", "final"] }, archived: { type: "boolean" }, source_document_id: { type: "string" }, restore_revision_id: { type: "string" } }, additionalProperties: false } },
];

const scalarKeys = ["title", "origin", "stage", "organization", "contact", "audience", "brief", "fee", "next_action", "next_action_date", "history_verified", "archived"] as const;
const labels: Record<typeof scalarKeys[number], string> = { title: "강의명", origin: "시작 경로", stage: "진행 상태", organization: "기관", contact: "담당자·연락처", audience: "교육 대상", brief: "요청사항", fee: "강의료·지급 조건", next_action: "다음 할 일", next_action_date: "확인할 날짜", history_verified: "강의 이력 반영", archived: "보관함" };
const labelValue = (key: string, value: unknown) => key === "origin" ? ORIGINS[value as keyof typeof ORIGINS] : key === "stage" ? STAGES[value as keyof typeof STAGES] : typeof value === "boolean" ? value ? "예" : "아니요" : String(value || "미정 / 비움");
const sessionLabel = (s: LectureSession) => `${s.title} · ${{ lecture: "강의", prep: "준비", travel: "이동" }[s.kind]} · ${s.date || "날짜 미정"} · ${s.start ? `${s.start}–${s.end}` : "시간 미정"} · ${s.location || "장소 미정"} · ${s.confirmed ? "확정" : "가안"}`;
const checkLabel = (c: ChecklistItem) => `${c.done ? "완료" : "미완료"} · ${c.title}`;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const object = (value: unknown) => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("입력 형식을 확인해 주세요."); return value as Record<string, unknown>; };

/** Patch by known ID; untouched items survive. Removal must be explicit and visible. */
function mergeItems<T extends { id: string }>(raw: unknown, removed: unknown, existing: T[], defaults: (index: number) => T, keys: string[]) {
  if (!Array.isArray(raw) || raw.length > 80 || !Array.isArray(removed) || removed.length > 80) throw new Error("일정·준비 항목은 각각 80개까지 입력해 주세요.");
  const remove = new Set(removed.map(id => textValue(id, "제외할 항목", true, 80)!));
  if (remove.size !== removed.length || [...remove].some(id => !existing.some(item => item.id === id))) throw new Error("제외할 항목을 먼저 조회해 주세요.");
  const result = existing.filter(item => !remove.has(item.id)).map(item => ({ ...item }));
  const seen = new Set<string>();
  for (const value of raw) {
    const input = object(value);
    const id = input.id === undefined ? crypto.randomUUID() : textValue(input.id, "항목 ID", true, 80)!;
    const before = existing.find(item => item.id === id);
    if ((input.id !== undefined && !before) || seen.has(id) || remove.has(id)) throw new Error("중복되거나 찾을 수 없는 항목이에요. 최신 기록을 조회해 주세요.");
    seen.add(id);
    const after = { ...(before || defaults(result.length)), id, ...Object.fromEntries(keys.filter(key => input[key] !== undefined).map(key => [key, input[key]])) } as T;
    if (before) result[result.findIndex(item => item.id === id)] = after; else result.push(after);
  }
  return result;
}

export function patchLectureProject(input: Record<string, unknown>, before: Omit<LectureProject, "id" | "owner_id" | "version" | "updated_at"> = emptyProject()) {
  const next = { ...before, ...Object.fromEntries(scalarKeys.filter(key => input[key] !== undefined).map(key => [key, input[key]])) };
  if (input.stage !== undefined && input.stage !== "completed" && input.history_verified === undefined) next.history_verified = false;
  next.sessions = mergeItems(input.sessions ?? [], input.remove_session_ids ?? [], before.sessions, index => ({ id: "", title: `${index + 1}회차`, date: "", start: "", end: "", location: "", confirmed: false, kind: "lecture" }), ["title", "date", "start", "end", "location", "confirmed", "kind"]);
  next.checklist = mergeItems(input.checklist ?? [], input.remove_checklist_ids ?? [], before.checklist, () => ({ id: "", title: "", done: false }), ["title", "done"]);
  const values = projectInput(next);
  const signatures = values.sessions.map(s => JSON.stringify([s.kind, s.title, s.date, s.start, s.end]));
  if (new Set(signatures).size !== signatures.length) throw new Error("동일한 일정이 이미 있어요. 기존 일정을 수정해 주세요.");
  return values;
}

function projectDisplay(values: ReturnType<typeof projectInput>, before?: LectureProject) {
  const fields: ActionDisplay["fields"] = [];
  for (const key of scalarKeys) if (!before || values[key] !== before[key]) fields.push({ label: labels[key], value: before ? `${labelValue(key, before[key])}\n→ ${labelValue(key, values[key])}` : labelValue(key, values[key]) });
  const changes = <T extends { id: string }>(items: T[], old: T[], label: string, format: (item: T) => string) => {
    for (const item of items) { const previous = old.find(s => s.id === item.id); if (JSON.stringify(item) !== JSON.stringify(previous)) fields.push({ label: `${label} ${previous ? "변경" : "추가"}`, value: previous ? `${format(previous)}\n→ ${format(item)}` : format(item) }); }
    for (const item of old) if (!items.some(s => s.id === item.id)) fields.push({ label: `${label} 제외`, value: format(item) });
  };
  changes(values.sessions, before?.sessions || [], "일정 (한국)", sessionLabel);
  changes(values.checklist, before?.checklist || [], "준비 항목", checkLabel);
  if (!fields.length) throw new Error("변경할 내용이 없어요.");
  if (before) fields.unshift({ label: "대상 강의", value: before.title });
  return fields;
}

async function owned<T>(db: SupabaseClient, table: string, id: string, userId: string) {
  const { data, error } = await db.from(table).select("*").eq("id", id).eq("owner_id", userId).maybeSingle();
  if (error || !data || data.owner_id !== userId) throw new Error("내 강의 자료를 찾지 못했어요. 먼저 조회해 주세요.");
  return data as T;
}

export async function prepareLectureAction(db: SupabaseClient, name: string, input: Record<string, unknown>, userId: string) {
  if ((await workspaceAccess(db, userId)).restricted) throw new Error("강의 변경 권한이 없어요.");
  if (name === "create_lecture_project" || name === "update_lecture_project") {
    const before = name === "update_lecture_project" ? await owned<LectureProject>(db, "lecture_projects", uuidValue(input.project_id), userId) : undefined;
    if (before && input.expected_version !== before.version) throw new Error("강의 버전이 바뀌었어요. 최신 내용을 다시 읽고 변경해 주세요.");
    if (!before && input.origin === undefined) throw new Error("직접 제안인지 들어온 의뢰인지 알려 주세요.");
    const values = patchLectureProject(input, before || emptyProject(input.origin === "inquiry" ? "inquiry" : "proposal"));
    if (!before) {
      const { data, error } = await db.from("lecture_projects").select("id").eq("owner_id", userId).eq("archived", false).ilike("title", escapeLike(values.title)).ilike("organization", escapeLike(values.organization)).limit(1);
      if (error || data?.length) throw new Error(error ? "기존 강의를 확인하지 못했어요." : "같은 이름·기관의 강의가 있어요. 조회 후 기존 강의를 수정해 주세요.");
    }
    const rawDocs = input.documents ?? [];
    if (!Array.isArray(rawDocs) || rawDocs.length > 5 || (before && rawDocs.length)) throw new Error("새 강의에는 문서를 5개까지 함께 만들 수 있어요.");
    const documents = rawDocs.map(raw => { const d = object(raw); const validated = documentInput(d); return { ...validated, body: d.body === undefined ? documentTemplate(validated.kind) : validated.body, status: "draft", archived: false }; });
    return { payload: { values, ...(before ? { project_id: before.id, expected_version: before.version } : { documents }) }, display: { title: before ? "강의 정보·일정 변경" : "강의·일정·문서 생성", fields: projectDisplay(values, before), documents: documents.map(d => ({ title: `${KINDS[d.kind]} · ${d.title}`, body: d.body })), note: "확인 후 강의와 통합 캘린더에 반영합니다. 보관·취소된 강의는 캘린더에서 제외됩니다. 새 문서는 작성 중으로 저장합니다." } satisfies ActionDisplay };
  }
  if (name !== "save_lecture_document") throw new Error("지원하지 않는 강의 변경이에요.");
  const before = input.document_id ? await owned<LectureDocument>(db, "lecture_documents", uuidValue(input.document_id), userId) : undefined;
  if (before && input.expected_version !== before.version) throw new Error("문서 버전이 바뀌었어요. 최신 본문을 다시 읽고 변경해 주세요.");
  if (before && (input.kind !== undefined && input.kind !== before.kind || input.project_id !== undefined && input.project_id !== before.project_id)) throw new Error("문서 종류·소속 변경은 새 문서로 복사해 주세요.");
  if (input.archived !== undefined && typeof input.archived !== "boolean") throw new Error("보관 여부를 확인해 주세요.");
  if (input.source_document_id && (before || input.restore_revision_id)) throw new Error("문서 복사는 새 문서에서만 가능해요.");
  let source: Partial<LectureDocument> = {}, sourceLabel = "";
  if (input.source_document_id) { const doc = await owned<LectureDocument>(db, "lecture_documents", uuidValue(input.source_document_id), userId); source = { title: `${doc.title} · 복사`, kind: doc.kind, body: doc.body }; sourceLabel = `${doc.title} · v${doc.version} 복사`; }
  if (input.restore_revision_id) {
    if (!before || input.body !== undefined || input.title !== undefined) throw new Error("이전 버전 복원에는 대상 문서와 버전만 지정해 주세요.");
    const revision = await owned<LectureDocument & { document_id: string }>(db, "lecture_document_revisions", uuidValue(input.restore_revision_id), userId);
    if (revision.document_id !== before.id) throw new Error("이 문서의 저장 버전이 아니에요.");
    source = { title: revision.title, body: revision.body }; sourceLabel = `v${revision.version} 복원`;
  }
  const projectId = before ? before.project_id : input.project_id ? uuidValue(input.project_id) : null;
  const project = projectId ? await owned<LectureProject>(db, "lecture_projects", projectId, userId) : undefined;
  if (project?.archived && !before) throw new Error("보관된 강의는 복원한 뒤 문서를 추가해 주세요.");
  const values = documentInput({ ...(before || {}), ...source, ...Object.fromEntries(["title", "kind", "body", "status", "archived"].filter(key => input[key] !== undefined).map(key => [key, input[key]])) });
  if (!before && input.body === undefined && !input.source_document_id) values.body = documentTemplate(values.kind);
  const contentChanged = !before || values.title !== before.title || values.body !== before.body || !!input.restore_revision_id;
  if (contentChanged) { if (input.status === "final") throw new Error("새 내용은 먼저 작성 중으로 저장하고 검토한 뒤 확정해 주세요."); values.status = "draft"; }
  if (values.status === "final" && !values.body.trim()) throw new Error("빈 문서는 확정할 수 없어요.");
  const fields: ActionDisplay["fields"] = [{ label: "저장 위치", value: project?.title || "내 기본 자료" }, { label: "종류", value: KINDS[values.kind] }];
  for (const key of ["title", "status", "archived"] as const) if (!before || values[key] !== before[key]) { const label = { title: "제목", status: "상태", archived: "보관함" }[key]; const format = (v: unknown) => key === "status" ? v === "final" ? "확정본" : "작성 중" : labelValue(key, v); fields.push({ label, value: before ? `${format(before[key])}\n→ ${format(values[key])}` : format(values[key]) }); }
  if (sourceLabel) fields.push({ label: "원본", value: sourceLabel });
  if (before && !contentChanged && fields.length === 2) throw new Error("변경할 내용이 없어요.");
  return { payload: { values, project_id: projectId, ...(before ? { document_id: before.id, expected_version: before.version } : {}) }, display: { title: before ? "강의 문서 변경" : "강의 문서 저장", fields, documents: [{ title: values.title, body: values.body, ...(before && contentChanged ? { previousBody: before.body } : {}) }], note: "펼쳐서 본문 전체를 검토해 주세요. 기존 저장 이력은 유지됩니다. 내용 수정·복원은 작성 중으로 저장하며, 외부에 발송하지 않습니다." } satisfies ActionDisplay };
}
