"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { waitingLabel } from "@/lib/task-waiting";
import { taskStatusLabel } from "@/lib/tasks";
import { recordDate } from "@/lib/workspace-progress";

type Snapshot = Record<string, string | null>;
interface Activity { id: string; actor_id: string | null; created_at: string; before_state: Snapshot | null; after_state: Snapshot }
export function TaskHistory({ taskId, profiles }: { taskId: string; profiles: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Activity[]>([]);
  const [state, setState] = useState("최근 변경 기록을 불러오는 중…");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await createClient().from("task_activity").select("id, actor_id, created_at, before_state, after_state").eq("task_id", taskId).order("created_at", { ascending: false }).limit(10);
        if (!active) return;
        if (error) { setState("변경 기록을 불러오지 못했습니다. 데이터베이스 설정과 연결을 확인해 주세요."); return; }
        setRows((data ?? []) as Activity[]); setState(data?.length ? "" : "이력 기능 적용 이후의 변경 기록이 없습니다.");
      } catch { if (active) setState("변경 기록을 불러오지 못했습니다."); }
    })();
    return () => { active = false; };
  }, [taskId]);
  const person = (id: string | null) => profiles.find((item) => item.id === id)?.name ?? (id ? "담당 확인 필요" : "미지정");
  function changes(row: Activity) {
    const before = row.before_state, after = row.after_state;
    if (!before) return `업무 등록 · ${taskStatusLabel(after.status ?? "todo")}${after.waiting_on && after.waiting_on !== "none" ? ` · ${waitingLabel(after.waiting_on)}: ${after.waiting_reason}` : ""}`;
    const parts = [];
    if (before.status !== after.status) parts.push(`${taskStatusLabel(before.status ?? "")} → ${taskStatusLabel(after.status ?? "")}`);
    if (before.assignee_id !== after.assignee_id) parts.push(`담당 ${person(before.assignee_id)} → ${person(after.assignee_id)}`);
    if (before.waiting_on !== after.waiting_on) parts.push(`${waitingLabel(before.waiting_on ?? "none")} → ${waitingLabel(after.waiting_on ?? "none")}`);
    if (before.waiting_reason !== after.waiting_reason) parts.push(`사유: ${before.waiting_reason || "없음"} → ${after.waiting_reason || "없음"}`);
    if (before.followup_date !== after.followup_date) parts.push(`재확인일: ${before.followup_date || "미정"} → ${after.followup_date || "미정"}`);
    if (before.due_date !== after.due_date) parts.push(`마감: ${before.due_date || "미정"} → ${after.due_date || "미정"}`);
    return parts.join(" · ") || "업무 내용 수정";
  }
  return <details className="mt-4 rounded-lg border border-border bg-surface p-3 text-sm" open><summary className="cursor-pointer font-semibold text-ink">최근 변경 기록</summary>{state && <p className="mt-2 text-muted">{state}</p>}<ol className="mt-2 space-y-3">{rows.map((row) => <li key={row.id}><p>{changes(row)}</p><p className="mt-1 text-xs text-muted">{recordDate(row.created_at)} · {row.actor_id ? person(row.actor_id) : "시스템"}</p></li>)}</ol></details>;
}
