"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useClientContext } from "@/components/providers/client-context";
import { saveClient } from "@/lib/actions/settings";
import { clientPath } from "@/lib/nav";
import { getService } from "@/lib/services";
import { channelLabel } from "@/lib/channels";
import { kstMonth, monthBoundsUtc, monthContentSummary, type PublishRow } from "@/lib/publish-stats";
import { metricLabel, surfaceLabel, formatValue } from "@/lib/tracker";
import { PartnerOverview } from "./partner-overview";
import { PartnershipSummary } from "./partnership";
import { clientKind } from "@/types/database";
import type { ClientService } from "@/types/database";

type ContentRow = PublishRow & { id: string; title: string | null; approval_status: string; created_by: string | null };
type TaskRow = { id: string; title: string; due_date: string | null; status: string; assignee_id: string | null };
type PlanRow = { id: string; title: string; channel: string; status: string; scheduled_date: string | null };
type ReportRow = { year_month: string; status: string };
type MetricRow = { week: string; surface: string; metric: string; value: number | null };

interface Loaded {
  contents: ContentRow[];
  tasks: TaskRow[];
  plans: PlanRow[];
  services: ClientService[];
  reports: ReportRow[];
  metrics: MetricRow[];
  profiles: { id: string; name: string }[];
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 고객사 개요 — 다음으로 할 일, 이번 달 콘텐츠, 계약, 최근 성과, 리포트, 메모 */
export function ClientOverview({ id }: { id: string }) {
  const { clients, loading } = useClientContext();
  if (loading) return <p className="text-sm text-muted">불러오는 중…</p>;
  return clientKind(clients.find((c) => c.id === id) ?? {}) === "partner" ? <PartnerOverview key={id} id={id} /> : <CustomerOverview key={id} id={id} />;
}

function CustomerOverview({ id }: { id: string }) {
  const { clients } = useClientContext();
  const client = clients.find((c) => c.id === id) ?? null;
  const [data, setData] = useState<{ id: string; loaded: Loaded } | null>(null);
  const ym = kstMonth(new Date().toISOString())!;
  const today = todayKst();

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const { startIso, endIso } = monthBoundsUtc(ym);
    Promise.all([
      supabase
        .from("contents")
        .select("id, title, channel, wp_post_id, published_at, created_at, approval_status, created_by")
        .eq("client_id", id)
        .or(
          `approval_status.in.(pending,rejected),and(created_at.gte.${startIso},created_at.lte.${endIso}),and(published_at.gte.${startIso},published_at.lte.${endIso})`,
        )
        .order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, title, due_date, status, assignee_id").eq("client_id", id).neq("status", "done").order("due_date", { nullsFirst: false }),
      supabase.from("content_plans").select("id, title, channel, status, scheduled_date").eq("client_id", id).neq("status", "published").order("scheduled_date", { nullsFirst: false }),
      supabase.from("client_services").select("*").eq("client_id", id).order("created_at"),
      supabase.from("reports").select("year_month, status").eq("client_id", id).order("year_month", { ascending: false }).limit(3),
      supabase
        .from("tracker_weekly_metrics")
        .select("week, surface, metric, value")
        .eq("client_id", id)
        .eq("intent", "all")
        .in("metric", ["mention_rate", "rank_found_rate"])
        .order("week", { ascending: false })
        .limit(60),
      supabase.from("profiles").select("id, name"),
    ]).then(([c, t, p, s, r, m, pr]) => {
      if (!active) return;
      setData({
        id,
        loaded: {
          contents: (c.data ?? []) as ContentRow[],
          tasks: (t.data ?? []) as TaskRow[],
          plans: (p.data ?? []) as PlanRow[],
          services: (s.data ?? []) as ClientService[],
          reports: (r.data ?? []) as ReportRow[],
          metrics: (m.data ?? []) as MetricRow[],
          profiles: (pr.data ?? []) as { id: string; name: string }[],
        },
      });
    });
    return () => {
      active = false;
    };
  }, [id, ym]);

  const loaded = data?.id === id ? data.loaded : null;
  if (!client) return null;
  if (!loaded) return <p className="text-sm text-muted">불러오는 중…</p>;

  const name = (pid: string | null) => loaded.profiles.find((p) => p.id === pid)?.name ?? "";
  const summary = monthContentSummary(loaded.contents, ym);
  const pending = loaded.contents.filter((c) => c.approval_status === "pending");
  const rejected = loaded.contents.filter((c) => c.approval_status === "rejected");
  const overdueTasks = loaded.tasks.filter((t) => t.due_date && t.due_date < today);
  const soonPlans = loaded.plans.filter((p) => p.scheduled_date && p.scheduled_date <= addDays(today, 7));
  const quota = loaded.services.filter((s) => s.status === "active").reduce((sum, s) => sum + (s.monthly_quota ?? 0), 0);
  const latestWeek = loaded.metrics[0]?.week;
  const latestMetrics = latestWeek ? loaded.metrics.filter((m) => m.week === latestWeek && m.value != null) : [];

  const todo: { key: string; title: string; badge?: { text: string; tone: "warn" | "bad" | "info" }; action: string; href: string; due: string }[] = [
    ...pending.map((c) => ({
      key: `p-${c.id}`,
      title: c.title || "(제목 없음)",
      badge: { text: "검수 필요", tone: "warn" as const },
      action: "검수하기",
      href: clientPath(id, "content", `view=library&contentId=${c.id}`),
      due: "",
    })),
    ...rejected.map((c) => ({
      key: `r-${c.id}`,
      title: c.title || "(제목 없음)",
      badge: { text: "수정 필요", tone: "bad" as const },
      action: "수정하기",
      href: clientPath(id, "content", `view=library&contentId=${c.id}`),
      due: "",
    })),
    ...soonPlans.map((p) => ({
      key: `s-${p.id}`,
      title: `${p.title} · ${channelLabel(p.channel)} 발행 예정`,
      badge: p.scheduled_date! < today ? { text: "지연", tone: "bad" as const } : undefined,
      action: "작업 보기",
      href: clientPath(id, "content", "view=plans"),
      due: p.scheduled_date!.slice(5).replace("-", "/"),
    })),
    ...loaded.tasks.slice(0, 5).map((t) => ({
      key: `t-${t.id}`,
      title: `${t.title}${t.assignee_id ? ` · ${name(t.assignee_id)}` : ""}`,
      badge: overdueTasks.includes(t) ? { text: "지연", tone: "bad" as const } : undefined,
      action: "업무 보기",
      href: "/tasks",
      due: t.due_date ? t.due_date.slice(5).replace("-", "/") : "",
    })),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-4">
        <Section title="다음으로 할 일" right={<span className="text-xs text-muted">{todo.length}건</span>}>
          {todo.length === 0 ? (
            <p className="text-sm text-muted">지금 처리할 일이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-border">
              {todo.map((t) => (
                <li key={t.key} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {t.title}
                    {t.badge && (
                      <span
                        className={[
                          "ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          t.badge.tone === "bad" ? "bg-red-50 text-red-700" : t.badge.tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-tint text-accent-deep",
                        ].join(" ")}
                      >
                        {t.badge.text}
                      </span>
                    )}
                  </span>
                  <span className="w-12 shrink-0 font-mono text-xs text-muted">{t.due}</span>
                  <Link href={t.href} className="shrink-0 rounded-md border border-accent px-2.5 py-1 text-xs font-semibold text-accent-deep hover:bg-tint">
                    {t.action}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`이번 달 콘텐츠 (${ym})`} right={<Link href={clientPath(id, "content")} className="text-xs text-accent-deep hover:underline">콘텐츠 →</Link>}>
          <Bars published={summary.published} pending={pending.length + rejected.length} planned={loaded.plans.filter((p) => p.scheduled_date?.startsWith(ym)).length} />
          <p className="mt-1.5 text-xs text-muted">
            {quota > 0 ? `약정 ${quota}건 중 발행 완료 ${summary.published}` : `발행 완료 ${summary.published}`} · 검수·수정 {pending.length + rejected.length} · 예정{" "}
            {loaded.plans.filter((p) => p.scheduled_date?.startsWith(ym)).length} · 이번 달 생성 {summary.total}
            {summary.wpDrafts ? ` · WP 초안만 ${summary.wpDrafts}` : ""}
          </p>
        </Section>

        <MemoCard clientId={id} initial={client.memo ?? ""} />
      </div>

      <div className="space-y-4">
        <Section title="계약" right={<Link href={clientPath(id, "info")} className="text-xs text-accent-deep hover:underline">+ 추가 · 수정</Link>}>
          {loaded.services.length === 0 ? (
            <p className="text-sm text-muted">등록된 계약이 없습니다.</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {loaded.services.map((s) => {
                const def = getService(s.service_type);
                const dLeft = s.end_date ? daysBetween(today, s.end_date) : null;
                return (
                  <div key={s.id}>
                    <dt className="font-medium text-ink">
                      {def ? `${def.emoji} ${def.label}` : s.service_type}
                      <span className={["ml-2 rounded-full px-2 py-0.5 text-[11px]", s.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-subtle text-muted"].join(" ")}>
                        {s.status === "active" ? "진행중" : s.status === "done" ? "완료" : s.status === "paused" ? "일시중지" : "종료"}
                      </span>
                    </dt>
                    <dd className="text-xs text-muted">
                      {s.start_date ?? "?"} ~ {s.end_date ?? "기간 없음"}
                      {s.monthly_fee ? ` · 월 ${Number(s.monthly_fee).toLocaleString("ko-KR")}원` : s.amount ? ` · ${Number(s.amount).toLocaleString("ko-KR")}원` : ""}
                      {s.status === "active" && dLeft != null && dLeft <= 30 && <span className="ml-1 font-medium text-amber-700">종료 D-{dLeft}</span>}
                    </dd>
                    <dd><PartnershipSummary value={s} partners={clients} /></dd>
                  </div>
                );
              })}
            </dl>
          )}
        </Section>

        <Section title="최근 성과" right={<Link href={clientPath(id, "geo")} className="text-xs text-accent-deep hover:underline">GEO · SEO →</Link>}>
          {latestMetrics.length === 0 ? (
            <p className="text-sm text-muted">트래커 결과가 아직 없습니다.</p>
          ) : (
            <dl className="space-y-1 text-sm">
              {latestMetrics.slice(0, 6).map((m) => (
                <div key={`${m.surface}-${m.metric}`} className="flex justify-between gap-2">
                  <dt className="truncate text-muted">
                    {surfaceLabel(m.surface)} · {metricLabel(m.metric)}
                  </dt>
                  <dd className="font-mono text-ink">{formatValue(m.metric, m.value)}</dd>
                </div>
              ))}
              <p className="text-[11px] text-muted">{latestWeek} 기준</p>
            </dl>
          )}
        </Section>

        <Section title="서치콘솔 · GA4" right={<Link href={clientPath(id, "reports")} className="text-xs text-accent-deep hover:underline">자료 보기 →</Link>}>
          {loaded.reports.length === 0 ? (
            <p className="text-sm text-muted">아직 불러온 달이 없습니다.</p>
          ) : (
            <ul className="text-sm">
              {loaded.reports.map((r) => (
                <li key={r.year_month} className="flex justify-between">
                  <span className="text-ink">{r.year_month}</span>
                  <span className="text-muted">저장됨</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Bars({ published, pending, planned }: { published: number; pending: number; planned: number }) {
  const total = Math.max(1, published + pending + planned);
  const w = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded">
      <span style={{ width: w(published) }} className="bg-emerald-500" />
      <span style={{ width: w(pending) }} className="bg-amber-400" />
      <span style={{ width: w(planned) }} className="bg-border" />
    </div>
  );
}

/** 자유 메모 — 입력을 멈추면 1초 뒤 저장 */
function MemoCard({ clientId, initial }: { clientId: string; initial: string }) {
  const [memo, setMemo] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refreshClients } = useClientContext();

  function onChange(v: string) {
    setMemo(v);
    setState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState("saving");
      const r = await saveClient(clientId, { memo: v.trim() || null });
      setState(r.ok ? "saved" : "error");
      if (r.ok) void refreshClients();
    }, 1000);
  }

  return (
    <Section
      title="메모"
      right={
        <span className="text-xs text-muted">
          {state === "saving" ? "저장 중…" : state === "saved" ? "저장됨" : state === "error" ? "저장 실패" : "입력을 멈추면 자동 저장"}
        </span>
      }
    >
      <textarea
        value={memo}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="예: 원장님은 목요일 오전 통화 선호. 사진은 병원에서 직접 제공."
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep"
      />
    </Section>
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
