export const WAITING_OPTIONS = [
  { key: "none", label: "대기 없음" },
  { key: "client", label: "고객 응답 대기" },
  { key: "vendor", label: "제작·유지보수사 대기" },
  { key: "internal", label: "내부 확인 대기" },
] as const;

export interface WaitingFields {
  waiting_on?: string;
  waiting_reason?: string | null;
  waiting_since?: string | null;
  followup_date?: string | null;
}

export const waitingLabel = (key?: string) => WAITING_OPTIONS.find((item) => item.key === key)?.label ?? "대기 없음";
export const isWaiting = (task: WaitingFields & { status: string }) => task.status !== "done" && !!task.waiting_on && task.waiting_on !== "none";
export const isExternalWaiting = (task: WaitingFields & { status: string }) => isWaiting(task) && ["client", "vendor"].includes(task.waiting_on!);
export function waitingSummary(task: WaitingFields & { status: string }): string {
  if (!isWaiting(task)) return "";
  return `${waitingLabel(task.waiting_on)} · ${task.waiting_reason || "사유 확인 필요"} · ${task.followup_date ? `${task.followup_date} 재확인` : "재확인일 미정"}`;
}
