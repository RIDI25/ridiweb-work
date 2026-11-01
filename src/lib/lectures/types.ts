import { dateValue, enumValue, textValue, uuidValue } from "@/lib/assistant/action-types";
export const ORIGINS = { proposal: "직접 제안", inquiry: "들어온 의뢰" } as const;
export const STAGES = { expected: "의뢰 예정", drafting: "제안 준비", sent: "회신 대기", discussing: "조건 협의", confirmed: "진행 확정", preparing: "강의 준비", completed: "진행 완료", cancelled: "종료 · 취소" } as const;
export const KINDS = { proposal: "제안서", curriculum: "커리큘럼", profile: "강사 소개", materials: "교안 · 참고자료", record: "결과 기록" } as const;
export type DocKind = keyof typeof KINDS;
export interface LectureSession { id: string; title: string; date: string; start: string; end: string; location: string; confirmed: boolean; kind: "lecture" | "prep" | "travel" }
export interface ChecklistItem { id: string; title: string; done: boolean }
export interface LectureProject {
  id: string; owner_id: string; title: string; origin: keyof typeof ORIGINS; stage: keyof typeof STAGES;
  organization: string; contact: string; audience: string; brief: string; fee: string;
  next_action: string; next_action_date: string | null; sessions: LectureSession[]; checklist: ChecklistItem[];
  history_verified: boolean; archived: boolean; version: number; updated_at: string;
}
export interface LectureDocument { id: string; project_id: string | null; owner_id: string; kind: DocKind; title: string; body: string; status: "draft" | "final"; archived: boolean; version: number; updated_at: string }
export interface DocumentRevision { id: string; document_id: string; title: string; body: string; status: "draft" | "final"; version: number; saved_at: string }
export const DEFAULT_CHECKLIST = ["기관 요청사항·강의 조건 확인", "제안서·커리큘럼 최종 검토", "교안·실습 자료 준비", "자료 전달·제출 마감 확인", "장소·장비·실습 환경 확인", "이동 시간·도착 시간 확인", "강의 기록·피드백 정리"];
export const emptyProject = (origin: keyof typeof ORIGINS = "proposal") => ({
  title: "", origin, stage: origin === "proposal" ? "drafting" as const : "expected" as const, organization: "", contact: "", audience: "", brief: "", fee: "", next_action: "", next_action_date: null, sessions: [] as LectureSession[], checklist: DEFAULT_CHECKLIST.map((title, i) => ({ id: `check-${i}`, title, done: false })), history_verified: false, archived: false,
});
export function projectInput(input: Record<string, unknown>) {
  const rawSessions = input.sessions ?? [], rawChecks = input.checklist ?? [];
  if (!Array.isArray(rawSessions) || rawSessions.length > 80 || !Array.isArray(rawChecks) || rawChecks.length > 80) throw new Error("회차와 준비 항목은 각각 80개까지 저장할 수 있어요.");
  const time = (v: unknown) => { const s = textValue(v, "시간", false, 5) || ""; if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Error("시간을 확인해 주세요."); return s; };
  const bool = (v: unknown) => { if (typeof v !== "boolean") throw new Error("선택 항목을 확인해 주세요."); return v; };
  const sessions: LectureSession[] = rawSessions.map(s => {
    if (!s || typeof s !== "object") throw new Error("회차 정보를 확인해 주세요.");
    const start = time(s.start), end = time(s.end);
    if (!!start !== !!end || (start && end <= start)) throw new Error("시작·종료 시간을 함께 입력하고 종료를 시작 이후로 설정해 주세요.");
    return { id: uuidValue(s.id), title: textValue(s.title, "회차명", true, 150)!, date: dateValue(s.date, "강의 날짜") || "", start, end, location: textValue(s.location, "장소", false, 300) || "", confirmed: bool(s.confirmed), kind: enumValue(s.kind, ["lecture", "prep", "travel"], "lecture") as LectureSession["kind"] };
  });
  if (sessions.some(s => s.confirmed && !s.date)) throw new Error("확정 일정에는 날짜가 필요해요.");
  if (new Set(sessions.map(s => s.id)).size !== sessions.length) throw new Error("중복된 회차가 있어요.");
  const checklist: ChecklistItem[] = rawChecks.map(c => ({ id: textValue(c.id, "항목 번호", true, 80)!, title: textValue(c.title, "준비 항목", true, 250)!, done: bool(c.done) }));
  const stage = enumValue(input.stage, Object.keys(STAGES)) as LectureProject["stage"];
  const history = bool(input.history_verified ?? false);
  if (history && stage !== "completed") throw new Error("진행 완료한 강의만 이력에 반영할 수 있어요.");
  return { title: textValue(input.title, "강의명", true, 200)!, origin: enumValue(input.origin, Object.keys(ORIGINS)) as LectureProject["origin"], stage,
    organization: textValue(input.organization, "기관명", false, 200) || "", contact: textValue(input.contact, "담당자·연락처", false, 1000) || "", audience: textValue(input.audience, "대상", false, 1000) || "", brief: textValue(input.brief, "요청사항", false, 20000) || "", fee: textValue(input.fee, "강의 조건", false, 1000) || "", next_action: textValue(input.next_action, "다음 할 일", false, 500) || "", next_action_date: dateValue(input.next_action_date, "확인할 날짜"), sessions, checklist, history_verified: history, archived: bool(input.archived ?? false) };
}
export function documentInput(input: Record<string, unknown>) {
  return { title: textValue(input.title, "문서 제목", true, 200)!, kind: enumValue(input.kind, Object.keys(KINDS)) as DocKind, body: textValue(input.body, "문서 내용", false, 60000) || "", status: enumValue(input.status, ["draft", "final"], "draft"), archived: input.archived === true };
}
export function lectureCalendar(projects: Pick<LectureProject, "id" | "title" | "sessions" | "archived" | "stage" | "next_action" | "next_action_date">[]) {
  return projects.filter(p => !p.archived && p.stage !== "cancelled").flatMap(p => [
    ...p.sessions.filter(s => s.date).map(s => ({ key: `lecture-${p.id}-${s.id}`, date: s.date, time: s.start || null, label: `${s.confirmed ? "" : "[가안] "}${p.title} · ${s.title}`, sub: [s.kind === "prep" ? "강의 준비" : s.kind === "travel" ? "강의 이동" : "강의", s.end && `~${s.end}`, s.location].filter(Boolean).join(" · "), href: `/lectures/${p.id}` })),
    ...(p.next_action && p.next_action_date && p.stage !== "completed" ? [{ key: `lecture-next-${p.id}`, date: p.next_action_date, time: null, label: p.next_action, sub: `강의 할 일 · ${p.title}`, href: `/lectures/${p.id}` }] : []),
  ]);
}
export function documentTemplate(kind: DocKind): string {
  const sections: Record<DocKind, string[]> = {
    proposal: ["제안 배경", "교육 대상과 목표", "기대효과", "강의 구성", "진행 방식·시간·장소", "강사 소개", "강의료·협의 사항"],
    curriculum: ["강의 주제", "대상·수준·사전 준비", "학습 목표", "시간별 구성", "실습과 결과물", "준비물·환경"],
    profile: ["이름·활동명", "한 줄 소개", "주요 전문 분야", "현재 활동", "확인된 경력·강의 이력", "짧은 소개", "행사 진행자용 소개 멘트"],
    materials: ["교안", "실습 자료", "참고 링크", "자료 전달·사용 안내"],
    record: ["실제 진행 일시·장소", "참석 현황", "진행 내용", "참가자 피드백", "개선할 점", "후속 요청·할 일"],
  };
  return sections[kind].map(s => `## ${s}\n\n`).join("\n");
}
