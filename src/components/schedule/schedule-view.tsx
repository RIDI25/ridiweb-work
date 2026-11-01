"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { lectureCalendar } from "@/lib/lectures/types";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DOW_KO as DOW,
  EVENT_TYPES,
  SOURCE_LABELS,
  SOURCE_STYLES,
  buildMonthGrid,
  eventTypeLabel,
  ymdOf,
} from "@/lib/schedule";
import { taskStatusLabel } from "@/lib/tasks";
import type { CalendarEvent } from "@/types/database";

const input =
  "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent-deep";

/** anchor가 속한 주(일~토)의 날짜들 */
function weekOf(anchor: Date): string[] {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return ymdOf(d);
  });
}

interface CalItem {
  key: string;
  kind: "event" | "task" | "invoice" | "lecture";
  href?: string;
  date: string;
  time: string | null;
  label: string;
  sub: string;
  event?: CalendarEvent;
}

interface EventDraft {
  title: string;
  event_date: string;
  event_time: string;
  event_type: string;
  client_id: string;
  assignee_id: string;
  memo: string;
}

/**
 * 스케줄 — 월간 캘린더 + 주간 리스트.
 * events(직접 등록) + tasks 마감일 + 세금계산서 발행일을 소스별 색으로 병합 표시.
 */
export function ScheduleView({
  me,
  today,
  initialEvents,
  tasks,
  invoices,
  clients,
  profiles,
  lectures, lecturesError,
}: {
  lectures: ReturnType<typeof lectureCalendar>;
  lecturesError: boolean;
  me: { id: string };
  today: string;
  initialEvents: CalendarEvent[];
  tasks: {
    id: string;
    title: string;
    due_date: string;
    status: string;
    assignee_id: string | null;
  }[];
  invoices: { id: string; issue_date: string; counterparty: string }[];
  clients: { id: string; name: string }[];
  profiles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [anchor, setAnchor] = useState<Date>(() => new Date(`${today}T12:00:00`));
  const [view, setView] = useState<"month" | "week">("month");
  const [msg, setMsg] = useState("");

  const emptyDraft: EventDraft = {
    title: "",
    event_date: today,
    event_time: "",
    event_type: "meeting",
    client_id: "",
    assignee_id: "",
    memo: "",
  };
  const [draft, setDraft] = useState<EventDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string | null) =>
    id ? (profiles.find((p) => p.id === id)?.name ?? "-") : "";
  const clientNameOf = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "-") : "";

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    const push = (it: CalItem) => {
      const list = map.get(it.date) ?? [];
      list.push(it);
      map.set(it.date, list);
    };
    for (const e of events) {
      push({
        key: `e-${e.id}`,
        kind: "event",
        date: e.event_date,
        time: e.event_time ? e.event_time.slice(0, 5) : null,
        label: e.title,
        sub: [
          eventTypeLabel(e.event_type),
          clientNameOf(e.client_id),
          nameOf(e.assignee_id),
        ]
          .filter(Boolean)
          .join(" · "),
        event: e,
      });
    }
    for (const t of tasks) {
      push({
        key: `t-${t.id}`,
        kind: "task",
        date: t.due_date,
        time: null,
        label: t.title,
        sub: [nameOf(t.assignee_id), taskStatusLabel(t.status)]
          .filter(Boolean)
          .join(" · "),
      });
    }
    for (const inv of invoices) {
      push({
        key: `i-${inv.id}`,
        kind: "invoice",
        date: inv.issue_date,
        time: null,
        label: `계산서 · ${inv.counterparty}`,
        sub: "발행일",
      });
    }
    for (const l of lectures) push({...l, kind: "lecture"});
    for (const list of map.values()) {
      list.sort((a, b) => (a.time ?? "99") < (b.time ?? "99") ? -1 : 1);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, tasks, invoices, lectures]);

  async function refetch() {
    const { data } = await supabase.from("events").select("*").order("event_date");
    if (data) setEvents(data as CalendarEvent[]);
  }

  async function saveEvent() {
    if (!draft.title.trim()) {
      setMsg("일정 제목을 입력하세요.");
      return;
    }
    if (!draft.event_date) {
      setMsg("날짜를 선택하세요.");
      return;
    }
    setBusy(true);
    setMsg("");
    const row = {
      title: draft.title.trim(),
      event_date: draft.event_date,
      event_time: draft.event_time || null,
      event_type: draft.event_type,
      client_id: draft.client_id || null,
      assignee_id: draft.assignee_id || null,
      memo: draft.memo.trim() || null,
    };
    const { error } = editingId
      ? await supabase
          .from("events")
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq("id", editingId)
      : await supabase.from("events").insert({ ...row, created_by: me.id });
    setBusy(false);
    if (error) {
      setMsg(`저장 실패: ${error.message}`);
      return;
    }
    setDraft(emptyDraft);
    setEditingId(null);
    setFormOpen(false);
    await refetch();
  }

  async function removeEvent(id: string) {
    if (!confirm("이 일정을 삭제할까요?")) return;
    const { data, error } = await supabase
      .from("events")
      .delete()
      .eq("id", id)
      .select("id");
    if (error || !data?.length) {
      setMsg(
        `삭제 실패: ${error?.message ?? "본인이 만든 일정 또는 owner만 삭제할 수 있습니다."}`,
      );
      return;
    }
    setEvents((es) => es.filter((e) => e.id !== id));
    setFormOpen(false);
    setEditingId(null);
  }

  function openCreate(date?: string) {
    setEditingId(null);
    setDraft({ ...emptyDraft, event_date: date ?? today });
    setFormOpen(true);
  }

  function openEdit(e: CalendarEvent) {
    setEditingId(e.id);
    setDraft({
      title: e.title,
      event_date: e.event_date,
      event_time: e.event_time ? e.event_time.slice(0, 5) : "",
      event_type: e.event_type,
      client_id: e.client_id ?? "",
      assignee_id: e.assignee_id ?? "",
      memo: e.memo ?? "",
    });
    setFormOpen(true);
  }

  function shift(dir: -1 | 1) {
    const d = new Date(anchor);
    if (view === "month") d.setMonth(d.getMonth() + dir, 1);
    else d.setDate(d.getDate() + dir * 7);
    setAnchor(d);
  }

  const weeks = buildMonthGrid(anchor.getFullYear(), anchor.getMonth());
  const weekDays = weekOf(anchor);
  const headLabel =
    view === "month"
      ? `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`
      : `${weekDays[0].slice(5).replace("-", "/")} ~ ${weekDays[6].slice(5).replace("-", "/")}`;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {lecturesError && <p role="alert">강의 일정을 불러오지 못했어요. 새로고침 후 확인해 주세요.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">캘린더</h1>
          <p className="mt-1 text-sm text-muted">
            강의·일정·업무 마감·세금계산서 발행일을 함께 봅니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-surface p-0.5 text-sm">
            {(
              [
                { key: "month", label: "월간" },
                { key: "week", label: "주간" },
              ] as { key: "month" | "week"; label: string }[]
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
          <button
            onClick={() => openCreate()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-ink hover:opacity-90"
          >
            + 새 일정
          </button>
        </div>
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {/* 일정 등록/수정 폼 */}
      {formOpen && (
        <section className="rounded-lg border border-accent-deep/30 bg-tint/30 p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">
            {editingId ? "일정 수정" : "새 일정"}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className={`${input} sm:col-span-2`}
              placeholder="일정 제목"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <input
              type="date"
              className={input}
              value={draft.event_date}
              onChange={(e) => setDraft({ ...draft, event_date: e.target.value })}
            />
            <input
              type="time"
              className={input}
              value={draft.event_time}
              onChange={(e) => setDraft({ ...draft, event_time: e.target.value })}
            />
            <select
              className={input}
              value={draft.event_type}
              onChange={(e) => setDraft({ ...draft, event_type: e.target.value })}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
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
              onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value })}
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
              className={input}
              placeholder="메모 (선택)"
              value={draft.memo}
              onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={saveEvent}
              disabled={busy}
              className="rounded-md bg-accent-deep px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "저장 중…" : editingId ? "수정 저장" : "등록"}
            </button>
            {editingId && (
              <button
                onClick={() => removeEvent(editingId)}
                className="rounded-md border border-red-200 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                삭제
              </button>
            )}
            <button
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
              className="rounded-md border border-border px-4 py-1.5 text-sm text-muted hover:text-ink"
            >
              취소
            </button>
          </div>
        </section>
      )}

      {/* 내비게이션 + 범례 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-1)}
            className="rounded-md border border-border px-2 py-1 text-sm text-muted hover:text-ink"
          >
            ◀
          </button>
          <button
            onClick={() => setAnchor(new Date(`${today}T12:00:00`))}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-muted hover:text-ink"
          >
            오늘
          </button>
          <button
            onClick={() => shift(1)}
            className="rounded-md border border-border px-2 py-1 text-sm text-muted hover:text-ink"
          >
            ▶
          </button>
          <span className="ml-2 text-sm font-semibold text-ink">{headLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {Object.entries(SOURCE_LABELS).map(([k, label]) => (
            <span
              key={k}
              className={`rounded px-1.5 py-0.5 font-medium ${SOURCE_STYLES[k]}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <section className="overflow-x-auto rounded-lg border border-border bg-surface">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 border-b border-border text-center text-xs text-muted">
              {DOW.map((d) => (
                <div key={d} className="py-2 font-medium">
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div
                key={wi}
                className="grid grid-cols-7 border-b border-border/60 last:border-0"
              >
                {week.map((date, di) => (
                  <div
                    key={di}
                    onClick={() => date && openCreate(date)}
                    className={[
                      "min-h-24 cursor-pointer border-r border-border/40 p-1.5 last:border-r-0",
                      date ? "hover:bg-subtle/60" : "bg-subtle/30",
                    ].join(" ")}
                  >
                    {date && (
                      <>
                        <p
                          className={[
                            "mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-xs",
                            date === today
                              ? "bg-accent-deep font-semibold text-white"
                              : "text-muted",
                          ].join(" ")}
                        >
                          {Number(date.slice(8))}
                        </p>
                        <div className="space-y-0.5">
                          {(itemsByDate.get(date) ?? []).slice(0, 3).map((it) => (
                            <button
                              key={it.key}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (it.href) router.push(it.href);
                                else if (it.event) openEdit(it.event);
                              }}
                              title={`${it.label}${it.sub ? ` (${it.sub})` : ""}`}
                              className={[
                                "block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium",
                                SOURCE_STYLES[it.kind],
                              ].join(" ")}
                            >
                              {it.time && <span className="font-mono">{it.time} </span>}
                              {it.label}
                            </button>
                          ))}
                          {(itemsByDate.get(date)?.length ?? 0) > 3 && (
                            <p className="px-1 text-[10px] text-muted">
                              외 {(itemsByDate.get(date)?.length ?? 0) - 3}건
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-surface">
          {weekDays.map((date, i) => {
            const items = itemsByDate.get(date) ?? [];
            return (
              <div
                key={date}
                className="flex gap-3 border-b border-border/60 p-3 last:border-0"
              >
                <div className="w-16 shrink-0">
                  <p
                    className={[
                      "text-sm font-semibold",
                      date === today ? "text-accent-deep" : "text-ink",
                    ].join(" ")}
                  >
                    {DOW[i]}
                  </p>
                  <p className="font-mono text-xs text-muted">
                    {date.slice(5).replace("-", "/")}
                  </p>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {items.length === 0 ? (
                    <p className="text-sm text-muted">-</p>
                  ) : (
                    items.map((it) => (
                      <div key={it.key} className="flex items-center gap-2 text-sm">
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_STYLES[it.kind]}`}
                        >
                          {SOURCE_LABELS[it.kind]}
                        </span>
                        {it.time && (
                          <span className="shrink-0 font-mono text-xs text-muted">
                            {it.time}
                          </span>
                        )}
                        {it.kind === "event" && it.event ? (
                          <button
                            onClick={() => openEdit(it.event!)}
                            className="truncate text-left text-ink hover:text-accent-deep hover:underline"
                          >
                            {it.label}
                          </button>
                        ) : (
                          <Link
                            href={it.href || (it.kind === "task" ? "/tasks" : "/revenue")}
                            className="truncate text-ink hover:text-accent-deep hover:underline"
                          >
                            {it.label}
                          </Link>
                        )}
                        {it.sub && (
                          <span className="ml-auto shrink-0 text-xs text-muted">
                            {it.sub}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <p className="text-xs text-muted">
        날짜 칸을 클릭하면 그 날짜로 새 일정을 등록합니다. 업무 마감·세금계산서
        칩은 각 메뉴에서 관리합니다.
      </p>
    </div>
  );
}
