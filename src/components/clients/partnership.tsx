import Link from "next/link";
import type { CollaborationFields, PartnerLink } from "@/lib/service-partners";

export function PartnerBadge({ partner }: { partner: PartnerLink }) {
  return <Link href={`/clients/${partner.id}/overview`} className="inline-flex rounded-full bg-tint px-2 py-0.5 text-xs font-medium text-accent-deep hover:underline">협업 · {partner.name}</Link>;
}

const input = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent-deep";

export function PartnershipFields({ value, onChange, partners }: { value: CollaborationFields; onChange: (value: CollaborationFields) => void; partners: PartnerLink[] }) {
  return <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <legend className="mb-2 text-sm font-medium text-ink">거래 · 담당 정보</legend>
    <label className="space-y-1 text-xs text-muted">거래 경로
      <select className={input} value={value.deal_channel ?? ""} onChange={(e) => onChange({ ...value, deal_channel: (e.target.value || null) as CollaborationFields["deal_channel"], partner_id: e.target.value === "partner" ? value.partner_id : null })}>
        <option value="">미지정</option><option value="direct">직접</option><option value="partner">협업</option>
      </select>
    </label>
    {value.deal_channel === "partner" && <label className="space-y-1 text-xs text-muted">협력사
      <select className={input} value={value.partner_id ?? ""} onChange={(e) => onChange({ ...value, partner_id: e.target.value || null })} required>
        <option value="">협력사 선택</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {!partners.length && <span className="block">고객/협력사에서 협력사를 먼저 등록해 주세요.</span>}
    </label>}
    {([ ["communication_contact", "소통 담당", "예: 협력사 김담당"], ["final_reviewer", "최종 검수자", "예: 고객사 박대표"], ["settlement_party", "정산 상대", "예: 협력사 / 담당자"] ] as const).map(([key, label, placeholder]) => <label key={key} className="space-y-1 text-xs text-muted">{label}<input className={input} maxLength={300} placeholder={placeholder} value={value[key] ?? ""} onChange={(e) => onChange({ ...value, [key]: e.target.value })} /></label>)}
  </fieldset>;
}

export function PartnershipSummary({ value, partners }: { value: CollaborationFields; partners: PartnerLink[] }) {
  const partner = partners.find((p) => p.id === value.partner_id);
  return <div className="mt-2 space-y-1">
    {value.deal_channel === "partner" && partner ? <PartnerBadge partner={partner} /> : <span className="text-xs text-muted">{value.deal_channel === "direct" ? "직접" : value.deal_channel === "partner" ? "협력사 확인 필요" : "거래 경로 미지정"}</span>}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{([ ["communication_contact", "소통"], ["final_reviewer", "검수"], ["settlement_party", "정산"] ] as const).map(([key, label]) => value[key] && <span className="break-all" key={key}>{label} · {value[key]}</span>)}</div>
  </div>;
}
