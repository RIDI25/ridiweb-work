import { loadWorkspaceProgress } from "@/lib/workspace-data";
import { ReviewInbox, ClientProgressTable, WaitingBoard } from "@/components/today/progress-board";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { channelLabel } from "@/lib/channels";
import { serviceLabel } from "@/lib/services";
import { kstMonth, monthBoundsUtc, monthContentSummary, type PublishRow } from "@/lib/publish-stats";
import { TrackerSummary } from "@/components/dashboard/tracker-summary";
import { ClientsGlance, TodayMemo, type TodayClientSummary, type TodayRow } from "@/components/today/today-view";
import { HomeCalendar, type CalInvoice, type CalPlan, type CalTask } from "@/components/today/home-calendar";
import type { CalendarEvent } from "@/types/database";

function kstToday(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmt(ymd: string): string {
  return ymd.slice(5).replace("-", "/");
}
function dueLabel(due: string | null, today: string): { label: string; overdue: boolean } {
  if (!due) return { label: "—", overdue: false };
  if (due < today) {
    const days = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${due}T00:00:00Z`).getTime()) / 86_400_000);
    return { label: `${fmt(due)} (${days}일 지연)`, overdue: true };
  }
  if (due === today) return { label: "오늘", overdue: false };
  return { label: fmt(due), overdue: false };
}

/**
 * 오늘 — "지금 무엇을 처리해야 하나". 검수·발행·업무·영업·정산·계약을 한 표로 모으고 행마다 다음 행동을 붙인다.
 * (2026-09-06 개편 1차. 2인 모두 같은 권한이라 역할별 화면 구분 없음, '내 담당만' 필터만 둔다)
 */
export default async function TodayPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const today = kstToday();
  const ym = kstMonth(new Date().toISOString())!;
  const { startIso, endIso } = monthBoundsUtc(ym);
  const contractHorizon = addDays(today, 30);
  // 달력 범위: 지난달 1일 ~ 다다음달 말일 (홈 달력에서 앞뒤 달로 넘길 수 있게)
  const [ty, tm] = today.split("-").map(Number);
  const calStart = `${tm === 1 ? ty - 1 : ty}-${String(tm === 1 ? 12 : tm - 1).padStart(2, "0")}-01`;
  const calEndDate = new Date(Date.UTC(ty, tm + 2, 0));
  const calEnd = calEndDate.toISOString().slice(0, 10);

  const [clientsRes, profilesRes, reviewRes, tasksRes, leadsRes, plansRes, invoicesRes, paymentsRes, servicesRes, eventsRes, monthContentsRes, calPlansRes, calTasksRes, calInvoicesRes, progress] =
    await Promise.all([
      supabase.from("clients").select("id, name, is_internal, status").order("is_internal", { ascending: false }).order("created_at"),
      supabase.from("profiles").select("id, name"),
      supabase
        .from("contents")
        .select("id, client_id, title, channel, approval_status, created_by, created_at")
        .in("approval_status", ["pending", "rejected"])
        .order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, title, client_id, assignee_id, due_date, status").neq("status", "done").lte("due_date", today).order("due_date"),
      supabase
        .from("leads")
        .select("id, company_name, next_followup, created_by, status")
        .in("status", ["inquiry", "consulting", "quoted"])
        .lte("next_followup", today)
        .order("next_followup"),
      supabase
        .from("content_plans")
        .select("id, client_id, title, channel, scheduled_date, assignee, status")
        .neq("status", "published")
        .lte("scheduled_date", today)
        .order("scheduled_date"),
      supabase.from("tax_invoices").select("id, counterparty, end_client_name, total_amount, issue_date").eq("status", "issued").order("issue_date"),
      supabase.from("invoice_payments").select("invoice_id, amount"),
      supabase.from("client_services").select("id, client_id, service_type, end_date").eq("status", "active").gte("end_date", today).lte("end_date", contractHorizon),
      supabase.from("events").select("*").gte("event_date", calStart).lte("event_date", calEnd).order("event_date").order("event_time"),
      supabase
        .from("contents")
        .select("client_id, channel, wp_post_id, published_at, created_at, approval_status")
        .or(`and(created_at.gte.${startIso},created_at.lte.${endIso}),and(published_at.gte.${startIso},published_at.lte.${endIso})`),
      supabase
        .from("content_plans")
        .select("id, client_id, title, channel, scheduled_date, status")
        .neq("status", "published")
        .gte("scheduled_date", calStart)
        .lte("scheduled_date", calEnd)
        .order("scheduled_date"),
      supabase.from("tasks").select("id, title, due_date, assignee_id, client_id").neq("status", "done").gte("due_date", calStart).lte("due_date", calEnd),
      supabase.from("tax_invoices").select("id, issue_date, counterparty").neq("status", "cancelled").gte("issue_date", calStart).lte("issue_date", calEnd),
      loadWorkspaceProgress(supabase),
    ]);

  type ClientLite = { id: string; name: string; is_internal: boolean; status: string };
  const clients = (clientsRes.data ?? []) as ClientLite[];
  const profiles = (profilesRes.data ?? []) as { id: string; name: string }[];
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? "—";
  const personName = (id: string | null) => profiles.find((p) => p.id === id)?.name ?? "";

  const rows: TodayRow[] = [];

  for (const c of (reviewRes.data ?? []) as { id: string; client_id: string; title: string | null; channel: string; approval_status: string; created_by: string | null }[]) {
    const rejected = c.approval_status === "rejected";
    rows.push({
      key: `review-${c.id}`,
      group: "review",
      clientId: c.client_id,
      clientName: clientName(c.client_id),
      title: `${c.title || "(제목 없음)"} · ${channelLabel(c.channel)}`,
      badge: rejected ? "수정 필요" : "검수 필요",
      tone: rejected ? "bad" : "warn",
      action: { label: rejected ? "수정하기" : "검수하기", href: `/clients/${c.client_id}/content?view=library&contentId=${c.id}` },
      due: null,
      dueLabel: "—",
      assigneeId: c.created_by,
      assignee: personName(c.created_by),
    });
  }

  for (const p of (plansRes.data ?? []) as { id: string; client_id: string; title: string; channel: string; scheduled_date: string | null; assignee: string | null }[]) {
    const d = dueLabel(p.scheduled_date, today);
    rows.push({
      key: `publish-${p.id}`,
      group: "publish",
      clientId: p.client_id,
      clientName: clientName(p.client_id),
      title: `${p.title} · ${channelLabel(p.channel)} 발행 예정`,
      badge: d.overdue ? "지연" : "오늘 발행",
      tone: d.overdue ? "bad" : "info",
      action: { label: "발행 기록", href: `/clients/${p.client_id}/content?view=plans` },
      due: p.scheduled_date,
      dueLabel: d.label,
      assigneeId: p.assignee,
      assignee: personName(p.assignee),
    });
  }

  for (const t of (tasksRes.data ?? []) as { id: string; title: string; client_id: string | null; assignee_id: string | null; due_date: string | null }[]) {
    const d = dueLabel(t.due_date, today);
    rows.push({
      key: `task-${t.id}`,
      group: "task",
      clientId: t.client_id,
      clientName: t.client_id ? clientName(t.client_id) : "옵티파이 내부",
      title: t.title,
      badge: d.overdue ? "지연" : "오늘 마감",
      tone: d.overdue ? "bad" : "info",
      action: { label: "업무 보기", href: "/tasks" },
      due: t.due_date,
      dueLabel: d.label,
      assigneeId: t.assignee_id,
      assignee: personName(t.assignee_id),
    });
  }

  for (const l of (leadsRes.data ?? []) as { id: string; company_name: string; next_followup: string | null; created_by: string | null; status: string }[]) {
    const d = dueLabel(l.next_followup, today);
    rows.push({
      key: `lead-${l.id}`,
      group: "lead",
      clientId: null,
      clientName: l.company_name,
      title: `후속 연락 · ${l.status === "quoted" ? "견적 보냄" : l.status === "consulting" ? "상담 중" : "문의"}`,
      badge: d.overdue ? "지연" : "오늘 연락",
      tone: d.overdue ? "bad" : "info",
      action: { label: "연락 기록", href: "/sales" },
      due: l.next_followup,
      dueLabel: d.label,
      assigneeId: l.created_by,
      assignee: personName(l.created_by),
    });
  }

  const paid = new Map<string, number>();
  for (const p of (paymentsRes.data ?? []) as { invoice_id: string; amount: number }[]) {
    paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Number(p.amount));
  }
  for (const inv of (invoicesRes.data ?? []) as { id: string; counterparty: string; end_client_name: string | null; total_amount: number; issue_date: string }[]) {
    const remaining = Number(inv.total_amount) - (paid.get(inv.id) ?? 0);
    if (remaining <= 0) continue;
    rows.push({
      key: `invoice-${inv.id}`,
      group: "invoice",
      clientId: null,
      clientName: inv.end_client_name ?? inv.counterparty,
      title: `미수금 ${remaining.toLocaleString("ko-KR")}원 (${fmt(inv.issue_date)} 발행)`,
      badge: "약정일 없음",
      tone: "muted",
      action: { label: "입금 기록", href: "/revenue" },
      due: null,
      dueLabel: "약정일 없음",
      assigneeId: null,
      assignee: "",
    });
  }

  for (const s of (servicesRes.data ?? []) as { id: string; client_id: string; service_type: string; end_date: string | null }[]) {
    const d = dueLabel(s.end_date, today);
    rows.push({
      key: `contract-${s.id}`,
      group: "contract",
      clientId: s.client_id,
      clientName: clientName(s.client_id),
      title: `${serviceLabel(s.service_type)} 계약 종료 예정`,
      badge: "재계약 논의",
      tone: "warn",
      action: { label: "계약 보기", href: `/clients/${s.client_id}/info` },
      due: s.end_date,
      dueLabel: d.label,
      assigneeId: null,
      assignee: "",
    });
  }

  const toneRank: Record<string, number> = { bad: 0, warn: 1, info: 2, muted: 3 };
  rows.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  const monthContents = (monthContentsRes.data ?? []) as (PublishRow & { client_id: string; approval_status: string })[];
  const overdueByClient = new Map<string, number>();
  for (const r of rows) if (r.tone === "bad" && r.clientId) overdueByClient.set(r.clientId, (overdueByClient.get(r.clientId) ?? 0) + 1);
  const clientSummaries: TodayClientSummary[] = clients
    .filter((c) => c.status === "active")
    .map((c) => {
      const mine = monthContents.filter((x) => x.client_id === c.id);
      const s = monthContentSummary(mine, ym);
      return {
        id: c.id,
        name: c.name,
        isInternal: c.is_internal,
        generated: s.total,
        published: s.published,
        pending: rows.filter((r) => r.group === "review" && r.clientId === c.id).length,
        overdue: overdueByClient.get(c.id) ?? 0,
      };
    });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-1">
        <div><h1 className="text-2xl font-bold tracking-tight">오늘</h1><p className="mt-2 text-sm text-muted">확인할 일부터 보고, 고객별 다음 행동을 이어가세요.</p></div>
        <time dateTime={today} className="pt-2 text-xs text-muted">{today.replaceAll("-", ". ")}</time>
      </div>
      {progress.warnings.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{progress.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
      <ReviewInbox reviews={progress.reviews} unavailable={progress.reviewUnavailable} />
      <WaitingBoard items={progress.waitingItems} unavailable={progress.reviewUnavailable} />
      <ClientProgressTable clients={progress.clients.filter((client) => client.clientStatus === "active")} />
      <p className="text-xs text-muted">최근 기록은 등록·변경 시각입니다. 고객 전달·고객 확인 여부는 별도로 확인해 주세요.</p>
      <h2 className="pt-2 text-lg font-semibold">일정과 나머지 할 일</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HomeCalendar
            me={{ id: profile.id }}
            initialEvents={(eventsRes.data ?? []) as CalendarEvent[]}
            tasks={(calTasksRes.data ?? []) as CalTask[]}
            invoices={(calInvoicesRes.data ?? []) as CalInvoice[]}
            plans={(calPlansRes.data ?? []) as CalPlan[]}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            profiles={profiles}
          />
        </div>
        <div className="lg:col-span-2">
          <TodayMemo rows={rows} me={{ id: profile.id, name: profile.name }} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ClientsGlance clients={clientSummaries} ym={ym} />
        <TrackerSummary />
      </div>
    </div>
  );
}
