"use client";

import Link from "next/link";
import type { lectureCalendar } from "@/lib/lectures/types";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DOW_KO, EVENT_TYPES, SOURCE_STYLES, buildMonthGrid, eventTypeLabel } from "@/lib/schedule";
import type { CalendarEvent } from "@/types/database";

export interface CalTask {
  id: string;
  title: string;
  due_date: string;
  assignee_id: string | null;
  client_id: string | null;
}
export interface CalInvoice {
  id: string;
  issue_date: string;
  counterparty: string;
}
export interface CalPlan {
  id: string;
  client_id: string;
  title: string;
  channel: string;
  scheduled_date: string;
  status: string;
}

interface CalItem {
  key: string;
  kind: "event" | "task" | "invoice" | "publish" | "lecture";
  date: string;
  time: string | null;
  label: string;
  sub: string;
  href?: string;
  event?: CalendarEvent;
}

const KIND_STYLE: Record<CalItem["kind"], string> = {
  lecture: SOURCE_STYLES.lecture,
  event: SOURCE_STYLES.event,
  task: SOURCE_STYLES.task,
  invoice: SOURCE_STYLES.invoice,
  publish: "bg-emerald-50 text-emerald-700",
};
const KIND_LABEL: Record<CalItem["kind"], string> = { lecture: "강의", event: "일정", task: "업무 마감", invoice: "세금계산서", publish: "발행 예정" };

const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent-deep";

/**
 * 홈 맨 위 캘린더 — 날짜를 누르면 그 자리에서 일정을 적어 바로 저장한다.
 * 일정 + 업무 마감 + 세금계산서 발행일 + 콘텐츠 발행 예정을 한 달력에 겹쳐 보인다. 수정·상세는 /schedule.
 */
export function HomeCalendar({
  today,
  me,
  initialEvents,
  tasks,
  invoices,
  plans,
  clients,
  profiles,
  lectures,
}: {
  lectures: ReturnType<typeof lectureCalendar>;
  today: string;
  me: { id: string };
  initialEvents: CalendarEvent[];
  tasks: CalTask[];
  invoices: CalInvoice[];
  plans: CalPlan[];
  clients: { id: string; name: string }[];
  profiles: { id: string; name: string }[];
}) {
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: todayYear, m: todayMonth - 1 });
  const [picked, setPicked] = useState<string>(today);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [type, setType] = useState("meeting");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const nameOf = (id: string | null) => (id ? (profiles.find((p) => p.id === id)?.name ?? "") : "");
  const clientNameOf = (id: string | null) => (id ? (clients.find((c) => c.id === id)?.name ?? "") : "");

  const items: CalItem[] = [
    ...lectures.map(l=>({...l,kind:"lecture" as const})),
    ...events.map((e) => ({
      key: `e-${e.id}`,
      kind: "event" as const,
      date: e.event_date,
      time: e.event_time ? e.event_time.slice(0, 5) : null,
      label: e.title,
      sub: [eventTypeLabel(e.event_type), clientNameOf(e.client_id), nameOf(e.assignee_id)].filter(Boolean).join(" · "),
      event: e,
    })),
    ...tasks.map((t) => ({
      key: `t-${t.id}`,
      kind: "task" as const,
      date: t.due_date,
      time: null,
      label: t.title,
      sub: [clientNameOf(t.client_id), nameOf(t.assignee_id)].filter(Boolean).join(" · "),
      href: "/tasks",
    })),
    ...invoices.map((i) => ({
      key: `i-${i.id}`,
      kind: "invoice" as const,
      date: i.issue_date,
      time: null,
      label: `계산서 · ${i.counterparty}`,
      sub: "발행일",
      href: "/revenue",
    })),
    ...plans.map((p) => ({
      key: `p-${p.id}`,
      kind: "publish" as const,
      date: p.scheduled_date,
      time: null,
      label: p.title,
      sub: `${clientNameOf(p.client_id)} · 발행 예정`,
      href: `/clients/${p.client_id}/content?view=plans`,
    })),
  ];
  const byDate = new Map<string, CalItem[]>();
  for (const it of items) {
    const list = byDate.get(it.date) ?? [];
    list.push(it);
    byDate.set(it.date, list);
  }
  for (const list of byDate.values()) list.sort((a, b) => ((a.time ?? "99") < (b.time ?? "99") ? -1 : 1));

  const weeks = buildMonthGrid(cursor.y, cursor.m);
  const pickedItems = byDate.get(picked) ?? [];
  const pickedDow = DOW_KO[new Date(`${picked}T00:00:00`).getDay()];

  function moveMonth(delta: number) {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }

  async function addEvent() {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    setMsg("");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("events")
      .insert({
        title: t,
        event_date: picked,
        event_time: time || null,
        event_type: type,
        client_id: clientId || null,
        assignee_id: me.id,
        created_by: me.id,
      })
      .select("*")
      .single();
    setBusy(false);
    if (error || !data) {
      setMsg(`저장 실패: ${error?.message ?? "알 수 없음"}`);
      return;
    }
    setEvents((prev) => [...prev, data as CalendarEvent]);
    setTitle("");
    setTime("");
    setMsg("저장됨");
    setTimeout(() => setMsg(""), 1500);
  }

  async function removeEvent(e: CalendarEvent) {
    if (!window.confirm(`'${e.title}' 일정을 지울까요?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("events").delete().eq("id", e.id);
    if (error) {
      setMsg(`삭제 실패: ${error.message}`);
      return;
    }
    setEvents((prev) => prev.filter((x) => x.id !== e.id));
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => moveMonth(-1)} aria-label="이전 달" className="rounded-md px-2 py-0.5 text-sm text-muted hover:bg-subtle">
              ‹
            </button>
            <h2 className="min-w-24 text-center text-sm font-semibold text-ink">
              {cursor.y}년 {cursor.m + 1}월
            </h2>
            <button onClick={() => moveMonth(1)} aria-label="다음 달" className="rounded-md px-2 py-0.5 text-sm text-muted hover:bg-subtle">
              ›
            </button>
            {(cursor.y !== todayYear || cursor.m !== todayMonth - 1) && (
              <button
                onClick={() => {
                  setCursor({ y: todayYear, m: todayMonth - 1 });
                  setPicked(today);
                }}
                className="ml-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:text-ink"
              >
                오늘
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden gap-1 sm:flex">
              {(Object.keys(KIND_LABEL) as CalItem["kind"][]).map((k) => (
                <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_STYLE[k]}`}>
                  {KIND_LABEL[k]}
                </span>
              ))}
            </span>
            <Link href="/schedule" className="text-xs text-accent-deep hover:underline">
              스케줄 →
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted">
          {DOW_KO.map((d, i) => (
            <div key={d} className={["py-1 font-medium", i === 0 ? "text-red-500" : i === 6 ? "text-accent-deep" : ""].join(" ")}>
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((date, di) => (
              <div key={di} className="min-h-16 border-t border-border/40 p-0.5">
                {date && (
                  <button
                    onClick={() => setPicked(date)}
                    className={[
                      "block h-full w-full rounded-md p-1 text-left transition-colors",
                      picked === date ? "bg-tint ring-1 ring-accent/40" : "hover:bg-subtle",
                    ].join(" ")}
                  >
                    <p
                      className={[
                        "mb-0.5 inline-flex h-4.5 w-4.5 items-center justify-center rounded-full font-mono text-[11px]",
                        date === today ? "bg-accent-deep font-semibold text-white" : "text-muted",
                      ].join(" ")}
                    >
                      {Number(date.slice(8))}
                    </p>
                    {(byDate.get(date) ?? []).slice(0, 3).map((it) => (
                      <p key={it.key} title={it.label} className={["mb-0.5 truncate rounded px-1 py-px text-[9px] font-medium", KIND_STYLE[it.kind]].join(" ")}>
                        {it.time ? `${it.time} ` : ""}
                        {it.label}
                      </p>
                    ))}
                    {(byDate.get(date)?.length ?? 0) > 3 && <p className="px-1 text-[9px] text-muted">+{(byDate.get(date)?.length ?? 0) - 3}</p>}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 고른 날짜: 일정 목록 + 바로 입력 (달력 아래 한 줄) */}
      <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-accent/30 bg-tint/30 p-3 md:grid-cols-2">
        <div>
        <h2 className="mb-2 text-sm font-semibold text-accent-deep">
          {picked === today ? "오늘 · " : ""}
          {Number(picked.slice(5, 7))}/{Number(picked.slice(8))} ({pickedDow})
        </h2>
        {pickedItems.length === 0 ? (
          <p className="text-sm text-muted">이 날 등록된 일정이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {pickedItems.map((it) => (
              <li key={it.key} className="flex items-center gap-2 text-sm">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_STYLE[it.kind]}`}>{KIND_LABEL[it.kind]}</span>
                {it.time && <span className="shrink-0 font-mono text-xs text-muted">{it.time}</span>}
                {it.href ? (
                  <Link href={it.href} className="min-w-0 flex-1 truncate text-ink hover:text-accent-deep hover:underline">
                    {it.label}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-ink" title={it.event?.memo ?? undefined}>
                    {it.label}
                  </span>
                )}
                {it.sub && <span className="shrink-0 text-[11px] text-muted">{it.sub}</span>}
                {it.event && (
                  <button onClick={() => removeEvent(it.event!)} aria-label="일정 삭제" className="shrink-0 text-xs text-muted hover:text-red-600">
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        </div>
        <div className="space-y-2 md:border-l md:border-accent/20 md:pl-3">
          <p className="text-[11px] font-semibold text-accent-deep">이 날에 일정 추가</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addEvent();
            }}
            placeholder="예: 예시 고객사 미팅"
            className={`w-full ${input}`}
          />
          <div className="grid grid-cols-3 gap-2">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} aria-label="시간" />
            <select value={type} onChange={(e) => setType(e.target.value)} className={input} aria-label="종류">
              {EVENT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={input} aria-label="고객사">
              <option value="">고객사 없음</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addEvent}
              disabled={busy || !title.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "저장 중…" : "추가"}
            </button>
            <span className="text-xs text-muted">{msg || "제목만 적고 Enter 를 눌러도 됩니다. 수정은 스케줄에서."}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
