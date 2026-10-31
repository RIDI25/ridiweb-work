import { dateValue, textValue, uuidValue } from "@/lib/assistant/action-types";

export interface MeetingNote {
  id: string; title: string; meeting_date: string; client_id: string | null;
  participants: string; body: string; archived: boolean; version: number;
  updated_at: string; created_by: string;
}
export interface NoteHit { id: string; source: "vault" | "meeting"; title: string; path: string; excerpt: string; updated_at: string }
export interface VaultState { vault_name: string; note_count: number; skipped_count: number; last_success_at: string | null; last_attempt_at: string; error: string | null }
export const MEETING_TEMPLATE = "## 논의 내용\n\n\n## 결정 사항\n\n\n## 후속 할 일\n\n- [ ] \n\n## 확인이 필요한 점\n\n";
export function meetingInput(raw: Record<string, unknown>) {
  return {
    title: textValue(raw.title, "회의 제목", true, 200)!,
    meeting_date: dateValue(raw.meeting_date, "회의 날짜") ?? (() => { throw new Error("회의 날짜를 입력해 주세요."); })(),
    client_id: raw.client_id ? uuidValue(raw.client_id) : null,
    participants: textValue(raw.participants, "참석자", false, 1000) ?? "",
    body: textValue(raw.body, "회의 내용", false, 60000) ?? "",
  };
}
export function meetingMarkdown(note: Pick<MeetingNote, "title" | "meeting_date" | "participants" | "body">, clientName?: string) {
  return `# ${note.title}\n\n- 날짜: ${note.meeting_date}\n- 고객사: ${clientName || "내부 · 공통"}\n- 참석자: ${note.participants || "미기재"}\n\n${note.body}\n`;
}
export function noteExcerpt(body: string, offset: number) {
  const start = Math.max(0, Math.min(Number.isFinite(offset) ? Math.floor(offset) : 0, body.length));
  return { body: body.slice(start, start + 12000), offset: start, next_offset: start + 12000 < body.length ? start + 12000 : null };
}
