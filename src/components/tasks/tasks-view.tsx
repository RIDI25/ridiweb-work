"use client";

import { useMemo, useRef, useState } from "react";
import { WAITING_OPTIONS, isWaiting, waitingSummary } from "@/lib/task-waiting";
import { TaskHistory } from "./task-history";
import { dateValue } from "@/lib/assistant/action-types";
import { createClient } from "@/lib/supabase/client";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  taskPriorityDef,
  taskTypeLabel,
} from "@/lib/tasks";
import { TemplateSection } from "@/components/tasks/template-section";
import type { ClientService, Task, TaskTemplate } from "@/types/database";

const input =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent-deep";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ViewMode = "list" | "kanban" | "templates";

interface TaskDraft {
  waiting_on: string;
  waiting_reason: string;
  followup_date: string;
  title: string;
  client_id: string;
  assignee_id: string;
  due_date: string;
  task_type: string;
  priority: string;
  memo: string;
}

/**
 * 업무 보드 — 목록/칸반(드래그로 상태 변경)/반복 업무 템플릿.
 * 기본 필터는 "내 업무(미완료)". CRUD는 브라우저 클라이언트로 직접 — RLS가 권한을 강제한다.
 */
export function TasksView({
  me,
  initialTaskId,
  initialTasks,
  profiles,
  clients,
  initialTemplates,
  services,
}: {
  me: { id: string; role: string };
  initialTaskId?: string;
  initialTasks: Task[];
  profiles: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  initialTemplates: TaskTemplate[];
  services: ClientService[];
}) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [previousTasks, setPreviousTasks] = useState(initialTasks);
  if (previousTasks !== initialTasks) {
    setPreviousTasks(initialTasks);
    setTasks(initialTasks);
  }
  const [focusedTask, setFocusedTask] = useState(initialTaskId ?? null);
  const [view, setView] = useState<ViewMode>("list");
  const [fAssignee, setFAssignee] = useState<string>(initialTaskId ? "all" : me.id);
  const [fStatus, setFStatus] = useState<string>(initialTaskId ? "all" : "open");
  const [fWaiting, setFWaiting] = useState("all");
  const saveLock = useRef(false);
  const [fClient, setFClient] = useState<string>("all");
  const [msg, setMsg] = useState("");

  const emptyDraft: TaskDraft = {
    waiting_on: "none", waiting_reason: "", followup_date: "",
    title: "",
    client_id: "",
    assignee_id: me.id,
    due_date: "",
    task_type: "ops",
    priority: "normal",
    memo: "",
  };
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [draftVersion, setDraftVersion] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const today = todayYmd();
  const nameOf = (id: string | null) =>
    id ? (profiles.find((p) => p.id === id)?.name ?? "-") : "미지정";
  const clientNameOf = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "-") : "";

  async function refetch() {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (data) setTasks(data as Task[]);
  }

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (!focusedTask || t.id === focusedTask) &&
          (fAssignee === "all" || t.assignee_id === fAssignee) &&
          (fClient === "all" || t.client_id === fClient) &&
          (fWaiting === "all" || (fWaiting === "waiting" ? isWaiting(t) : t.waiting_on === fWaiting && isWaiting(t))) &&
          (view === "kanban" ||
            fStatus === "all" ||
            (fStatus === "open" ? t.status !== "done" : t.status === fStatus)),
      ),
    [tasks, fAssignee, fStatus, fClient, fWaiting, view, focusedTask],
  );

  async function saveTask() {
    if (saveLock.current) return;
    if (draft.waiting_on !== "none" && tasks.find((task) => task.id === editingId)?.status === "done") { setMsg("완료된 업무에는 대기를 등록할 수 없습니다. 업무 상태를 먼저 변경해 주세요."); return; }
    if (draft.waiting_on !== "none" && !draft.waiting_reason.trim()) { setMsg("대기 사유를 입력해 주세요."); return; }
    try { dateValue(draft.followup_date, "재확인일"); } catch (error) { setMsg((error as Error).message); return; }
    if (!draft.title.trim()) {
      setMsg("제목을 입력하세요.");
      return;
    }
    saveLock.current = true;
    setBusy(true);
    setMsg("");
    const row = {
      waiting_on: draft.waiting_on,
      waiting_reason: draft.waiting_on === "none" ? null : draft.waiting_reason.trim(),
      followup_date: draft.waiting_on === "none" ? null : draft.followup_date || null,
      title: draft.title.trim(),
      client_id: draft.client_id || null,
      assignee_id: draft.assignee_id || null,
      due_date: draft.due_date || null,
      task_type: draft.task_type,
      priority: draft.priority,
      memo: draft.memo.trim() || null,
    };
    try {
      const { data, error } = editingId
        ? await supabase.from("tasks").update(row).eq("id", editingId).eq("updated_at", draftVersion).select("id")
        : await supabase.from("tasks").insert({ ...row, status: "todo", created_by: me.id }).select("id");
      if (error) throw new Error(`저장 실패: ${error.message}${error.message.includes("waiting_") || error.message.includes("followup_date") ? " · 대기 기록 데이터베이스 설정이 필요합니다." : ""}`);
      if (!data?.length) throw new Error("업무가 변경되거나 삭제되었습니다. 최신 내용을 다시 열어 확인해 주세요.");
      setDraft(emptyDraft); setEditingId(null); setDraftVersion(null); setFormOpen(false);
      await refetch();
    } catch (error) { setMsg(error instanceof Error ? error.message : "저장 결과를 확인하지 못했습니다. 새로고침 후 다시 확인해 주세요."); }
    finally { saveLock.current = false; setBusy(false); }
  }

  async function changeStatus(id: string, status: string) {
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    const { error } = await supabase
      .from("tasks")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setTasks(prev);
      setMsg(`상태 변경 실패: ${error.message}`);
    } else { await refetch(); }
  }

  async function removeTask(id: string) {
    if (!confirm("이 업무를 삭제할까요?")) return;
    const { data, error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", id)
      .select("id");
    if (error || !data?.length) {
      setMsg(
        `삭제 실패: ${error?.message ?? "본인이 만든 업무 또는 owner만 삭제할 수 있습니다."}`,
      );
      return;
    }
    setTasks((ts) => ts.filter((t) => t.id !== id));
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setDraftVersion(t.updated_at);
    setDraft({
      waiting_on: t.waiting_on ?? "none", waiting_reason: t.waiting_reason ?? "", followup_date: t.followup_date ?? "",
      title: t.title,
      client_id: t.client_id ?? "",
      assignee_id: t.assignee_id ?? "",
      due_date: t.due_date ?? "",
      task_type: t.task_type,
      priority: t.priority,
      memo: t.memo ?? "",
    });
    setFormOpen(true);
  }

  const overdue = (t: Task) =>
    !!t.due_date && t.due_date < today && t.status !== "done";

  const dueLabel = (t: Task) =>
    t.due_date ? (t.due_date === today ? "오늘" : t.due_date.slice(5).replace("-", "/")) : "";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {focusedTask && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-tint p-4 text-sm"><span>{tasks.some((task) => task.id === focusedTask) ? "선택한 업무를 표시하고 있습니다." : "선택한 업무를 찾을 수 없습니다."}</span><button type="button" onClick={() => setFocusedTask(null)} className="font-semibold text-accent-deep underline">전체 업무 보기</button></div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">업무</h1>
          <p className="mt-1 text-sm text-muted">
            팀 업무 보드 — 담당·마감·상태를 공유합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-surface p-0.5 text-sm">
            {(
              [
                { key: "list", label: "목록" },
                { key: "kanban", label: "칸반" },
                { key: "templates", label: "반복 업무" },
              ] as { key: ViewMode; label: string }[]
            ).map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={[
                  "rounded px-3 py-1 font-medium transition-colors",
                  view === v.key
                    ? "bg-tint text-accent-deep"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view !== "templates" && (
            <button
              onClick={() => {
                setEditingId(null);
                setDraft(emptyDraft);
                setFormOpen((o) => !o);
              }}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-ink hover:opacity-90"
            >
              + 새 업무
            </button>
          )}
        </div>
      </div>

      {focusedTask && !formOpen && <TaskHistory key={`${focusedTask}-${tasks.find((task) => task.id === focusedTask)?.updated_at}`} taskId={focusedTask} profiles={profiles} />}
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {view === "templates" ? (
        <TemplateSection
          meId={me.id}
          initialTemplates={initialTemplates}
          services={services}
          clients={clients}
          profiles={profiles}
        />
      ) : (
        <>
          {/* 새 업무 / 수정 폼 */}
          {formOpen && (
            <section className="rounded-lg border border-accent-deep/30 bg-tint/30 p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">
                {editingId ? "업무 수정" : "새 업무"}
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  className={`${input} sm:col-span-2`}
                  placeholder="업무 제목"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
                <select
                  className={input}
                  value={draft.client_id}
                  onChange={(e) => setDraft({ ...draft, client_id: e.target.value })}
                >
                  <option value="">클라이언트 없음</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className={input}
                  value={draft.assignee_id}
                  onChange={(e) =>
                    setDraft({ ...draft, assignee_id: e.target.value })
                  }
                >
                  <option value="">담당 미지정</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === me.id ? " (나)" : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className={input}
                  value={draft.due_date}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                />
                <select
                  className={input}
                  value={draft.task_type}
                  onChange={(e) => setDraft({ ...draft, task_type: e.target.value })}
                >
                  {TASK_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <select
                  className={input}
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p.key} value={p.key}>
                      우선순위 {p.label}
                    </option>
                  ))}
                </select>
                <input
                  className={input}
                  placeholder="메모 (선택)"
                  value={draft.memo}
                  onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2">
                <label className="text-sm text-muted">대기 대상<select aria-label="대기 대상" className={`${input} mt-1 w-full`} value={draft.waiting_on} onChange={(e) => setDraft({ ...draft, waiting_on: e.target.value })}>{WAITING_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
                <label className="text-sm text-muted">다시 확인할 날짜<input aria-label="다시 확인할 날짜" type="date" className={`${input} mt-1 w-full`} disabled={draft.waiting_on === "none"} value={draft.followup_date} onChange={(e) => setDraft({ ...draft, followup_date: e.target.value })} /></label>
                {draft.waiting_on !== "none" && <label className="text-sm text-muted sm:col-span-2">대기 사유<textarea aria-label="대기 사유" className={`${input} mt-1 w-full`} maxLength={2000} rows={2} placeholder="예: 유지보수사에 수정 지시서 전달, 반영 일정 회신 대기" value={draft.waiting_reason} onChange={(e) => setDraft({ ...draft, waiting_reason: e.target.value })} /></label>}
                <p className="text-xs text-muted sm:col-span-2">대기 해제는 업무 완료와 별개입니다. 업무를 완료하면 대기도 해제됩니다.</p>
              </div>
              {editingId && <TaskHistory key={`${editingId}-${tasks.find((task) => task.id === editingId)?.updated_at}`} taskId={editingId} profiles={profiles} />}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveTask}
                  disabled={busy}
                  className="rounded-md bg-accent-deep px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "저장 중…" : editingId ? "수정 저장" : "등록"}
                </button>
                <button
                  onClick={() => {
                    setFormOpen(false);
                    setEditingId(null);
                    setDraft(emptyDraft);
                  }}
                  className="rounded-md border border-border px-4 py-1.5 text-sm text-muted hover:text-ink"
                >
                  취소
                </button>
              </div>
            </section>
          )}

          {/* 필터 */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={input}
              value={fAssignee}
              onChange={(e) => setFAssignee(e.target.value)}
            >
              <option value="all">담당자 전체</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === me.id ? " (나)" : ""}
                </option>
              ))}
            </select>
            {view === "list" && (
              <select
                className={input}
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
              >
                <option value="open">미완료</option>
                <option value="all">상태 전체</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <select
              className={input}
              value={fClient}
              onChange={(e) => setFClient(e.target.value)}
            >
              <option value="all">클라이언트 전체</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select aria-label="대기 필터" className={input} value={fWaiting} onChange={(e) => setFWaiting(e.target.value)}><option value="all">대기 여부 전체</option><option value="waiting">대기 중인 업무</option>{WAITING_OPTIONS.filter((item) => item.key !== "none").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
            <span className="text-xs text-muted">{filtered.length}건</span>
          </div>

          {view === "list" ? (
            <section className="overflow-x-auto rounded-lg border border-border bg-surface">
              {filtered.length === 0 ? (
                <p className="p-6 text-sm text-muted">
                  표시할 업무가 없습니다. 새 업무를 등록해보세요.
                </p>
              ) : (
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">상태</th>
                      <th className="px-3 py-2 font-medium">업무</th>
                      <th className="px-3 py-2 font-medium">유형</th>
                      <th className="px-3 py-2 font-medium">클라이언트</th>
                      <th className="px-3 py-2 font-medium">담당</th>
                      <th className="px-3 py-2 font-medium">마감</th>
                      <th className="px-3 py-2 font-medium">우선순위</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2">
                          <select
                            className="rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent-deep"
                            value={t.status}
                            onChange={(e) => changeStatus(t.id, e.target.value)}
                          >
                            {TASK_STATUSES.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <p
                            className={[
                              "font-medium",
                              t.status === "done" ? "text-muted line-through" : "text-ink",
                            ].join(" ")}
                          >
                            {t.title}
                            {t.template_id && (
                              <span className="ml-1.5 rounded bg-subtle px-1 py-0.5 text-[10px] text-muted">
                                반복
                              </span>
                            )}
                          </p>
                          {isWaiting(t) && <p className="mt-1 text-sm text-amber-800">{waitingSummary(t)}</p>}
                          {t.memo && (
                            <p className="mt-0.5 text-xs text-muted">{t.memo}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {taskTypeLabel(t.task_type)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {clientNameOf(t.client_id) || "-"}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink">
                          {nameOf(t.assignee_id)}
                        </td>
                        <td
                          className={[
                            "px-3 py-2 font-mono text-xs",
                            overdue(t) ? "font-semibold text-red-600" : "text-muted",
                          ].join(" ")}
                        >
                          {dueLabel(t) || "-"}
                          {overdue(t) && " (지남)"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={[
                              "rounded px-1.5 py-0.5 text-[11px] font-medium",
                              taskPriorityDef(t.priority)?.badge ?? "bg-subtle text-muted",
                            ].join(" ")}
                          >
                            {taskPriorityDef(t.priority)?.label ?? t.priority}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                          <button
                            onClick={() => startEdit(t)}
                            className="text-muted hover:text-accent-deep"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => removeTask(t.id)}
                            className="ml-2 text-muted hover:text-red-600"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ) : (
            /* 칸반 — 카드를 드래그해 상태 컬럼으로 이동 */
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              {TASK_STATUSES.map((s) => {
                const cards = filtered.filter((t) => t.status === s.key);
                return (
                  <div
                    key={s.key}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragId) changeStatus(dragId, s.key);
                      setDragId(null);
                    }}
                    className="min-h-[240px] rounded-lg border border-border bg-subtle/50 p-2"
                  >
                    <p
                      className={[
                        "mb-2 rounded px-2 py-1 text-xs font-semibold",
                        s.badge,
                      ].join(" ")}
                    >
                      {s.label} · {cards.length}
                    </p>
                    <div className="space-y-2">
                      {cards.map((t) => (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={() => setDragId(t.id)}
                          onClick={() => startEdit(t)}
                          className="cursor-grab rounded-md border border-border bg-surface p-2.5 shadow-sm hover:border-accent-deep/50"
                        >
                          <p className="text-sm font-medium text-ink">{t.title}</p>
                          {isWaiting(t) && <p className="mt-1 text-sm text-amber-800">{waitingSummary(t)}</p>}
                          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                            {t.priority === "high" && (
                              <span className="rounded bg-red-50 px-1 py-0.5 font-medium text-red-600">
                                높음
                              </span>
                            )}
                            <span>{taskTypeLabel(t.task_type)}</span>
                            {t.client_id && <span>· {clientNameOf(t.client_id)}</span>}
                            <span>· {nameOf(t.assignee_id)}</span>
                            {t.due_date && (
                              <span
                                className={[
                                  "font-mono",
                                  overdue(t) ? "font-semibold text-red-600" : "",
                                ].join(" ")}
                              >
                                · {dueLabel(t)}
                              </span>
                            )}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
