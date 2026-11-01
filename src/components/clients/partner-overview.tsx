"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useClientContext } from "@/components/providers/client-context";
import { serviceLabel, SERVICE_STATUS_LABELS } from "@/lib/services";
import type { ClientService } from "@/types/database";

export function PartnerOverview({ id }: { id: string }) {
  const { clients } = useClientContext();
  const [result, setResult] = useState<{ rows: ClientService[]; error: string; count: number } | null>(null);
  const [status, setStatus] = useState("all");
  useEffect(() => {
    let active = true;
    createClient().from("client_services").select("*", { count: "exact" }).eq("partner_id", id).order("created_at", { ascending: false }).then(({ data, error, count }) => {
      if (active) setResult({ rows: (data ?? []) as ClientService[], count: count ?? 0, error: error ? "협업 건을 불러오지 못했습니다. 새로고침해 주세요." : "" });
    });
    return () => { active = false; };
  }, [id]);
  if (!result) return <p className="text-sm text-muted">협업 건을 불러오는 중…</p>;
  if (result.error) return <p role="alert" className="text-sm text-red-600">{result.error}</p>;
  const visible = result.rows.filter((row) => status === "all" || row.status === status);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-ink">협업 건 <span className="ml-1 text-muted">{result.count}</span></h2>
      <select aria-label="협업 진행 상태" className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="all">전체 상태</option>{Object.entries(SERVICE_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </div>
    <div className="flex flex-wrap gap-4 text-sm text-muted">{Object.entries(SERVICE_STATUS_LABELS).map(([key, label]) => <span key={key}>{label} <b className="ml-1 text-ink">{result.rows.filter((s) => s.status === key).length}</b></span>)}</div>
    {result.count > result.rows.length && <p role="status" className="text-sm text-muted">최근 {result.rows.length}건 기준입니다.</p>}
    {!visible.length ? <div className="rounded-lg bg-surface p-6 text-sm text-muted">{!result.rows.length ? "연결된 협업 건이 없습니다. 고객사 → 기본정보 → 계약에서 이 협력사를 선택해 주세요." : "해당 상태의 협업 건이 없습니다."}</div> : <div className="divide-y divide-border rounded-lg bg-surface">
      {visible.map((service) => <article key={service.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div>
          <Link className="font-semibold text-ink hover:text-accent-deep" href={`/clients/${service.client_id}/info#service-${service.id}`}>{clients.find((c) => c.id === service.client_id)?.name ?? "고객사 확인 필요"}</Link>
          <p className="mt-1 text-sm text-ink">{serviceLabel(service.service_type)}</p>
          <p className="mt-1 text-xs text-muted">{service.start_date ?? "시작일 미정"}{service.end_date ? ` ~ ${service.end_date}` : ""}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">{([ ["communication_contact", "소통"], ["final_reviewer", "검수"], ["settlement_party", "정산"] ] as const).map(([key, label]) => <div className="contents" key={key}><dt className="text-muted">{label}</dt><dd className="break-all text-ink">{service[key] || "미지정"}</dd></div>)}</dl>
        <div className="flex items-start justify-between gap-3 lg:flex-col lg:items-end"><span className="rounded-full bg-subtle px-2 py-1 text-xs text-muted">{SERVICE_STATUS_LABELS[service.status]}</span><Link className="text-xs text-accent-deep hover:underline" href={`/clients/${service.client_id}/info#service-${service.id}`}>계약 보기 →</Link></div>
      </article>)}
    </div>}
  </section>;
}
