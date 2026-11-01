"use client";

import { useCallback, useEffect, useState } from "react";
import { useClientContext } from "@/components/providers/client-context";
import { PartnershipFields, PartnershipSummary } from "@/components/clients/partnership";
import { collaborationPatch, type CollaborationFields } from "@/lib/service-partners";
import { saveServicePartnership, refreshServiceViews } from "@/lib/actions/service-partners";
import { createClient } from "@/lib/supabase/client";
import {
  SERVICES,
  SERVICE_STATUS_LABELS,
  daysUntilEnd,
  getService,
  serviceLabel,
} from "@/lib/services";
import { won } from "@/lib/export/quote-model";
import type { ClientService, ServiceStatus } from "@/types/database";

const input =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent-deep";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1); // 6개월 계약 = 시작일 ~ 6개월 후 전날
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 고객사 상세 — 계약 서비스 관리 (업무 플로우의 기준) */
export function ClientServicesSection({
  clientId,
  readOnly,
}: {
  clientId: string;
  readOnly: boolean;
}) {
  const { clients } = useClientContext();
  const partners = clients.filter((c) => c.kind === "partner" && c.id !== clientId);
  const [collaboration, setCollaboration] = useState<CollaborationFields>({ deal_channel: "direct" });
  const [editing, setEditing] = useState<{ id: string; value: CollaborationFields } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [services, setServices] = useState<ClientService[]>([]);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState(SERVICES[0].key); // 항목명 — 추천 목록에 없어도 자유 입력
  const [billing, setBilling] = useState<"one_time" | "period">(SERVICES[0].billing);
  const [quota, setQuota] = useState("");
  const [startDate, setStartDate] = useState(today());
  // 종료일은 유형·시작일 기준으로 렌더 중 파생한다 (기간제면 시작일 + 기본 개월, 아니면 빈값).
  // 손으로 고친 값은 그 유형·시작일 조합에서만 유지되고, 유형이나 시작일이 바뀌면 다시 자동 계산된다
  // — effect 안 동기 setState 대신 keyed state 패턴.
  const [endDateOverride, setEndDateOverride] = useState<{ key: string; value: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const def = getService(type);
  const endDateKey = `${type}|${startDate}`;
  const endDate =
    endDateOverride && endDateOverride.key === endDateKey
      ? endDateOverride.value
      : billing === "period"
        ? addMonths(startDate, def?.defaultMonths ?? 6)
        : "";
  const setEndDate = (value: string) => setEndDateOverride({ key: endDateKey, value });

  const reload = useCallback(() => {
    createClient()
      .from("client_services")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        setLoaded(true);
        if (error) { setMsg("계약을 불러오지 못했습니다. 새로고침해 주세요."); return; }
        setServices((data ?? []) as ClientService[]);
      });
  }, [clientId]);

  useEffect(reload, [reload]);

  async function add() {
    const name = type.trim();
    if (!name) {
      setMsg("계약 항목명을 적으세요.");
      return;
    }
    let partnership: CollaborationFields;
    try { partnership = collaborationPatch(collaboration); }
    catch (error) { setMsg(error instanceof Error ? error.message : "거래 정보를 확인해 주세요."); return; }
    setBusy(true);
    setMsg("");
    const row: Record<string, unknown> = {
      ...partnership,
      client_id: clientId,
      service_type: name,
      billing,
      status: "active",
      start_date: startDate || null,
      end_date: billing === "period" ? endDate || null : null,
      amount: billing === "one_time" && amount ? Number(amount) : null,
      monthly_fee: billing === "period" && monthlyFee ? Number(monthlyFee) : null,
      memo: memo || null,
    };
    if (billing === "period" && quota) row.monthly_quota = Number(quota); // 0028 컬럼 — 적었을 때만 보낸다
    const { error } = await createClient().from("client_services").insert(row);
    setBusy(false);
    if (error) {
      setMsg(`추가 실패: ${error.message}`);
      return;
    }
    setAdding(false);
    setAmount("");
    setMonthlyFee("");
    setQuota("");
    setMemo("");
    setCollaboration({ deal_channel: "direct" });
    await refreshServiceViews();
    reload();
  }

  async function savePartnership() {
    if (!editing) return;
    setBusy(true); setMsg("");
    try {
      const result = await saveServicePartnership(editing.id, editing.value);
      if (!result.ok) { setMsg(result.error ?? "저장하지 못했습니다."); return; }
      setEditing(null); reload();
    } catch { setMsg("저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  async function updateStatus(svc: ClientService, status: ServiceStatus) {
    setBusy(true); setMsg("");
    const { error } = await createClient().from("client_services").update({ status, updated_at: new Date().toISOString() }).eq("id", svc.id).select("id").single();
    setBusy(false);
    if (error) { setMsg("상태를 변경하지 못했습니다."); return; }
    await refreshServiceViews(); reload();
  }

  async function renew(svc: ClientService) {
    // 재계약: 기존 계약 종료 처리 + 종료일 다음날부터 같은 기간으로 새 계약
    const def = getService(svc.service_type);
    const months = def?.defaultMonths ?? 6;
    const nextStart = svc.end_date
      ? (() => {
          const d = new Date(`${svc.end_date}T00:00:00`);
          d.setDate(d.getDate() + 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })()
      : today();
    if (!window.confirm(`${serviceLabel(svc.service_type)} 계약을 ${nextStart}부터 ${months}개월 연장할까요?`))
      return;
    setBusy(true); setMsg("");
    const { error } = await createClient().rpc("renew_client_service", { service_id: svc.id, new_start: nextStart, new_end: addMonths(nextStart, months) });
    setBusy(false);
    if (error) { setMsg("재계약하지 못했습니다. 기존 계약은 유지됩니다."); return; }
    await refreshServiceViews(); reload();
  }

  async function remove(svc: ClientService) {
    if (!window.confirm(`'${serviceLabel(svc.service_type)}' 계약을 삭제할까요?`)) return;
    setBusy(true); setMsg("");
    const { error } = await createClient().from("client_services").delete().eq("id", svc.id).select("id").single();
    setBusy(false);
    if (error) { setMsg("계약을 삭제하지 못했습니다."); return; }
    await refreshServiceViews(); reload();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          계약별 진행 상태와 거래 정보
        </p>
        <div className="flex items-center gap-2">

          {!readOnly && (
            <button
              disabled={busy}
              onClick={() => { setAdding((v) => !v); setEditing(null); setMsg(""); }}
              className="rounded-md border border-accent-deep px-3 py-1.5 text-sm font-medium text-accent-deep hover:bg-tint"
            >
              {adding ? "닫기" : "+ 계약 추가"}
            </button>
          )}
        </div>
      </div>

      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      {adding && (
        <div className="space-y-3 rounded-md bg-subtle p-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted">계약 항목</span>
              <input
                list="service-suggestions"
                value={type}
                onChange={(e) => {
                  const v = e.target.value;
                  setType(v);
                  const known = getService(v);
                  if (known) setBilling(known.billing);
                }}
                placeholder="예: SEO 컨설팅"
                className={`w-full ${input}`}
              />
              <datalist id="service-suggestions">
                {SERVICES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.emoji} {s.label} ({s.billing === "period" ? "기간제" : "일회성"})
                  </option>
                ))}
              </datalist>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted">청구 방식</span>
              <select value={billing} onChange={(e) => setBilling(e.target.value as "one_time" | "period")} className={`w-full ${input}`}>
                <option value="period">기간제 (월)</option>
                <option value="one_time">일회성</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted">시작일</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`w-full ${input}`} />
            </label>
            {billing === "period" ? (
              <>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted">종료일 (기본 {def?.defaultMonths ?? 6}개월)</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`w-full ${input}`} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted">월 비용 (원, 선택)</span>
                  <input type="number" min={0} value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} className={`w-full text-right ${input}`} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted">월 약정 수량 (건, 선택)</span>
                  <input type="number" min={0} value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="예: 4" className={`w-full text-right ${input}`} />
                </label>
              </>
            ) : (
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted">금액 (원, 선택)</span>
                <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={`w-full text-right ${input}`} />
              </label>
            )}
          </div>
          <PartnershipFields value={collaboration} onChange={setCollaboration} partners={partners} />
          <div className="flex items-center gap-2">
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 (선택)"
              className={`flex-1 ${input}`}
            />
            <button
              onClick={add}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold text-ink hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "추가 중…" : "계약 추가"}
            </button>
          </div>
        </div>
      )}

      {!loaded ? <p className="text-sm text-muted">불러오는 중…</p> : services.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-5 text-center text-sm text-muted">
          등록된 계약 서비스가 없습니다.
        </p>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => {
            const d = getService(svc.service_type);
            const days = svc.billing === "period" ? daysUntilEnd(svc.end_date) : null;
            const expiring = svc.status === "active" && days != null && days <= 30;
            return (
              <div
                key={svc.id}
                id={`service-${svc.id}`}
                className={[
                  "scroll-mt-6 flex flex-wrap items-center justify-between gap-2 rounded-md p-3",
                  expiring ? "bg-subtle" : "bg-surface",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {d?.emoji} {serviceLabel(svc.service_type)}
                    <span className="ml-2 text-xs text-muted">
                      {svc.billing === "period" ? "기간제" : "일회성"}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {svc.billing === "period" ? (
                      <>
                        {svc.start_date} ~ {svc.end_date}
                        {days != null && svc.status === "active" && (
                          <b className={expiring ? "ml-1 text-amber-700" : "ml-1"}>
                            {days >= 0 ? ` (D-${days})` : ` (${-days}일 경과)`}
                          </b>
                        )}
                        {svc.monthly_fee ? ` · 월 ${won(Number(svc.monthly_fee))}` : ""}
                        {svc.monthly_quota ? ` · 월 ${svc.monthly_quota}건 약정` : ""}
                      </>
                    ) : (
                      <>
                        {svc.start_date ?? ""}
                        {svc.amount ? ` · ${won(Number(svc.amount))}` : ""}
                      </>
                    )}
                    {svc.memo && ` · ${svc.memo}`}
                  </p>
                  <PartnershipSummary value={svc} partners={partners} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {!readOnly && <button disabled={busy} onClick={() => { setEditing({ id: svc.id, value: { ...svc } }); setAdding(false); setMsg(""); }} className="rounded px-2 py-1 text-xs text-accent-deep hover:bg-tint">거래 정보 수정</button>}
                  {!readOnly && svc.billing === "period" && svc.status === "active" && (
                    <button
                      disabled={busy}
                      onClick={() => renew(svc)}
                      className="rounded border border-accent-deep px-2 py-1 text-xs font-medium text-accent-deep hover:bg-tint"
                    >
                      재계약
                    </button>
                  )}
                  <select
                    value={svc.status}
                    onChange={(e) => updateStatus(svc, e.target.value as ServiceStatus)}
                    aria-label={`${serviceLabel(svc.service_type)} 상태`}
                    disabled={readOnly || busy}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent-deep disabled:bg-subtle"
                  >
                    {Object.entries(SERVICE_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {!readOnly && (
                    <button
                      disabled={busy}
                      onClick={() => remove(svc)}
                      className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-red-500"
                    >
                      삭제
                    </button>
                  )}
                </div>
                {editing?.id === svc.id && <div className="w-full space-y-3 rounded-md bg-subtle p-3">
                  <PartnershipFields value={editing.value} onChange={(value) => setEditing({ id: svc.id, value })} partners={partners} />
                  <div className="flex justify-end gap-2"><button disabled={busy} onClick={() => setEditing(null)} className="rounded px-3 py-1.5 text-sm text-muted">취소</button><button disabled={busy} onClick={savePartnership} className="rounded bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button></div>
                </div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
