"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useClientContext } from "@/components/providers/client-context";
import { saveClient } from "@/lib/actions/settings";
import { clientPath } from "@/lib/nav";
import { getService } from "@/lib/services";
import { kstMonth, monthContentSummary, monthBoundsUtc, type PublishRow } from "@/lib/publish-stats";
import { CLIENT_KIND_LABEL, clientKind, type Client, type ClientKind, type ClientService } from "@/types/database";

type ContentRow = PublishRow & { client_id: string; approval_status: string };
type PlanRow = { client_id: string; status: string; scheduled_date: string | null };
type TaskRow = { client_id: string | null; due_date: string | null; status: string };
type ReportRow = { client_id: string; year_month: string; status: string };

interface Loaded {
  services: ClientService[];
  contents: ContentRow[];
  plans: PlanRow[];
  tasks: TaskRow[];
  reports: ReportRow[];
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 고객사 목록 — 카드 하나가 이번 달 상태 요약. 이름을 누르면 고객사 카드로. */
export function ClientsIndex() {
  const { clients, loading, refreshClients } = useClientContext();
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [kind, setKind] = useState<ClientKind>("client");
  const kindReady = clients.some((c) => "kind" in c); // 0032 컬럼이 있을 때만 협업사로 만들 수 있다
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");

  const ym = kstMonth(new Date().toISOString())!;
  const today = todayKst();

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const { startIso, endIso } = monthBoundsUtc(ym);
    Promise.all([
      supabase.from("client_services").select("*").order("created_at"),
      supabase
        .from("contents")
        .select("client_id, channel, wp_post_id, published_at, created_at, approval_status")
        .or(
          `approval_status.in.(pending,rejected),and(created_at.gte.${startIso},created_at.lte.${endIso}),and(published_at.gte.${startIso},published_at.lte.${endIso})`,
        ),
      supabase.from("content_plans").select("client_id, status, scheduled_date").neq("status", "published"),
      supabase.from("tasks").select("client_id, due_date, status").neq("status", "done").not("due_date", "is", null),
      supabase.from("reports").select("client_id, year_month, status").order("year_month", { ascending: false }),
    ]).then(([s, c, p, t, r]) => {
      if (!active) return;
      setData({
        services: (s.data ?? []) as ClientService[],
        contents: (c.data ?? []) as ContentRow[],
        plans: (p.data ?? []) as PlanRow[],
        tasks: (t.data ?? []) as TaskRow[],
        reports: (r.data ?? []) as ReportRow[],
      });
    });
    return () => {
      active = false;
    };
  }, [ym]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setMsg("");
    const r = await saveClient(null, kind === "partner" && kindReady ? { name, kind } : { name });
    if (!r.ok) {
      setMsg(`만들지 못했습니다: ${r.error}`);
      setCreating(false);
      return;
    }
    const rows = await refreshClients();
    const made = [...rows].reverse().find((c) => c.name === name);
    setCreating(false);
    setNewName("");
    if (made) router.push(clientPath(made.id, "info"));
  }

  const counts = { client: clients.filter((c) => clientKind(c) === "client").length, partner: clients.filter((c) => clientKind(c) === "partner").length };
  const label = CLIENT_KIND_LABEL[kind];
  const visible = clients
    .filter((c) => clientKind(c) === kind)
    .filter((c) => (filter === "all" ? true : c.status === "active"))
    .filter((c) => (q.trim() ? c.name.includes(q.trim()) : true));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">고객사 · 협업사</h1>
          <p className="mt-1 text-sm text-muted">카드 하나가 이번 달 상태입니다. 이름을 누르면 그 회사의 모든 것이 한 장에 모입니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder={`새 ${label} 이름 (이름만 있으면 됩니다)`}
            className="w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep"
          />
          <button
            onClick={create}
            disabled={creating || !newName.trim()}
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "만드는 중…" : `+ 새 ${label}`}
          </button>
        </div>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <div className="flex gap-1 border-b border-border">
        {(["client", "partner"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={["-mb-px border-b-2 px-4 py-2 text-sm", kind === k ? "border-accent font-semibold text-accent-deep" : "border-transparent text-muted hover:text-ink"].join(" ")}
          >
            {CLIENT_KIND_LABEL[k]} <span className="ml-0.5 text-xs text-muted">{counts[k]}</span>
          </button>
        ))}
      </div>
      {kind === "partner" && !kindReady && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          협업사 구분 칸이 아직 없습니다. supabase/migrations/0032_client_kind.sql 을 SQL Editor 에서 실행하면 협업사를 만들고 옮길 수 있습니다.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["active", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={[
              "rounded-full border px-3 py-1 text-sm",
              filter === f ? "border-accent bg-tint font-semibold text-accent-deep" : "border-border text-muted hover:text-ink",
            ].join(" ")}
          >
            {f === "active" ? "운영중" : "전체"}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 검색"
          className="ml-auto w-44 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent-deep"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted">
          {counts[kind] === 0 ? `${label}가 없습니다. 위에 이름을 적고 만들어 보세요.${kind === "partner" ? " 기존 고객사는 기본정보에서 구분을 협업사로 바꾸면 옮겨집니다." : ""}` : `조건에 맞는 ${label}가 없습니다.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <ClientCardTile key={c.id} client={c} data={data} ym={ym} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientCardTile({ client, data, ym, today }: { client: Client; data: Loaded | null; ym: string; today: string }) {
  const services = (data?.services ?? []).filter((s) => s.client_id === client.id && s.status === "active");
  const contents = (data?.contents ?? []).filter((c) => c.client_id === client.id);
  const summary = monthContentSummary(contents, ym);
  const pending = contents.filter((c) => c.approval_status === "pending" || c.approval_status === "rejected").length;
  const planned = (data?.plans ?? []).filter((p) => p.client_id === client.id && p.scheduled_date && p.scheduled_date.startsWith(ym)).length;
  const dueDates = [
    ...(data?.tasks ?? []).filter((t) => t.client_id === client.id && t.due_date).map((t) => t.due_date!),
    ...(data?.plans ?? []).filter((p) => p.client_id === client.id && p.scheduled_date).map((p) => p.scheduled_date!),
  ].sort();
  const overdue = dueDates.filter((d) => d < today).length;
  const nextDue = dueDates.find((d) => d >= today) ?? null;
  const report = (data?.reports ?? []).find((r) => r.client_id === client.id) ?? null;
  const endingSoon = services.find((s) => s.end_date && s.end_date >= today && s.end_date <= addDays(today, 30));
  const quota = services.reduce((sum, s) => sum + (s.monthly_quota ?? 0), 0);

  const total = Math.max(1, summary.published + pending + planned);
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;

  return (
    <Link
      href={clientPath(client.id, "overview")}
      className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/60 hover:bg-tint/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-ink">
            {client.name}
            {client.is_internal && <span className="ml-1.5 rounded bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-muted">내부</span>}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {services.length === 0
              ? "진행중 계약 없음"
              : services.map((s) => getService(s.service_type)?.label ?? s.service_type).join(" · ")}
          </p>
        </div>
        {client.status !== "active" && (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
            {client.status === "paused" ? "일시중지" : "종료"}
          </span>
        )}
      </div>

      <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded">
        <span style={{ width: pct(summary.published) }} className="bg-emerald-500" title="발행 완료" />
        <span style={{ width: pct(pending) }} className="bg-amber-400" title="검수·수정" />
        <span style={{ width: pct(planned) }} className="bg-border" title="예정" />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {quota > 0 ? `약정 ${quota}건 중 발행 ${summary.published}` : `발행 ${summary.published}`} · 검수·수정 {pending} · 예정 {planned}
        {summary.wpDrafts ? ` · WP 초안만 ${summary.wpDrafts}` : ""}
      </p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {overdue > 0 && <span className="font-medium text-red-600">지연 {overdue}건</span>}
        <span className="text-muted">다음 마감 {nextDue ? nextDue.slice(5).replace("-", "/") : "없음"}</span>
        <span className="text-muted">리포트 {report ? `${report.year_month.slice(2)} ${report.status === "final" ? "확정" : "초안"}` : "없음"}</span>
        {endingSoon && <span className="font-medium text-amber-700">계약 종료 D-{daysBetween(today, endingSoon.end_date!)}</span>}
      </p>
    </Link>
  );
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}
