"use client";

import Link from "next/link";
import { useClientContext } from "@/components/providers/client-context";
import { clientPath, type ClientTab } from "@/lib/nav";
import { CLIENT_KIND_LABEL, clientKind } from "@/types/database";

const destinations: { tab: ClientTab["key"]; label: string; title: string; description: string }[] = [
  { tab: "seo", label: "SEO", title: "검색 순위", description: "키워드 순위와 측정 기록, 변화를 확인해요." },
  { tab: "geo", label: "GEO", title: "AI 노출", description: "AI 답변의 브랜드 노출과 인용, 경쟁 현황을 확인해요." },
  { tab: "reports", label: "Search Console · GA4", title: "검색 유입 · 분석", description: "검색 유입과 사이트 방문 흐름을 확인해요." },
];

export default function SearchOverviewPage() {
  const { clients, selectedClient, selectedClientId, setSelectedClientId, loading } = useClientContext();
  return <div className="mx-auto max-w-5xl space-y-8">
    <header><h1 className="text-2xl font-bold tracking-tight">SEO/GEO</h1><p className="mt-2 text-muted">고객을 선택하고 검색 성과와 AI 노출을 확인하세요.</p></header>
    {loading ? <p role="status" className="text-muted">고객을 불러오고 있어요…</p> : !clients.length ? <div className="rounded-xl border border-border bg-surface p-6"><p>먼저 고객을 등록해 주세요.</p><Link href="/clients" className="mt-3 inline-block text-accent-deep underline">고객/협력사 열기 →</Link></div> : <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-5">
        <label htmlFor="search-overview-client" className="font-semibold">확인할 고객</label>
        <select id="search-overview-client" value={selectedClientId ?? ""} onChange={event => setSelectedClientId(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-border bg-surface px-3 py-2 text-base focus:outline-2 focus:outline-accent">
          {!selectedClient && <option value="" disabled>고객을 선택해 주세요</option>}
          {(["client", "partner"] as const).map(kind => {
            const group = clients.filter(client => clientKind(client) === kind);
            return group.length ? <optgroup key={kind} label={CLIENT_KIND_LABEL[kind]}>{group.map(client => <option key={client.id} value={client.id}>{client.name}{client.is_internal ? " (내부)" : ""}</option>)}</optgroup> : null;
          })}
        </select>
        {selectedClient && <span className="text-sm text-muted">{selectedClient.name}의 자료로 이동해요.</span>}
      </div>
      {selectedClient && <div className="grid gap-4 lg:grid-cols-3">{destinations.map(destination => <Link key={destination.tab} href={clientPath(selectedClient.id, destination.tab)} className="group flex flex-col rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent">
        <span className="text-sm font-semibold text-accent-deep">{destination.label}</span>
        <h2 className="mt-4 text-xl font-semibold">{destination.title}</h2>
        <p className="mt-3 flex-1 text-sm leading-7 text-muted">{destination.description}</p>
        <span className="mt-8 text-sm font-medium text-accent-deep">확인하기 <span aria-hidden>↗</span></span>
      </Link>)}</div>}
    </>}
    <section className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6"><div><h2 className="font-semibold">새 사이트를 진단하려면</h2><p className="mt-1 text-sm text-muted">사이트 주소로 SEO 상태를 진단하고 제안서를 준비해요.</p></div><Link href="/diagnosis" className="rounded-lg border border-border bg-surface px-4 py-2.5 font-medium text-accent-deep hover:border-accent">사이트 진단 열기 →</Link></section>
  </div>;
}
