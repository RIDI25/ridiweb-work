"use client";

import { useState } from "react";
import Link from "next/link";
import { clientPartnerLinks, matchesServiceChannel, type ChannelFilter, type ServiceRelation } from "@/lib/service-partners";
import { useRouter } from "next/navigation";
import { useClientContext } from "@/components/providers/client-context";
import { saveClient } from "@/lib/actions/settings";
import { ClientProgressTable } from "@/components/today/progress-board";
import { buildWorkspaceProgress, type ClientProgress } from "@/lib/workspace-progress";
import { clientPath } from "@/lib/nav";
import { CLIENT_KIND_LABEL, clientKind, type ClientKind } from "@/types/database";

/** 고객사 목록 — 실제 업무·검수 기록과 다음 행동을 함께 보여준다. */
export function ClientsIndex({ progress, warnings, services }: { progress: ClientProgress[]; warnings: string[]; services: ServiceRelation[] }) {
  const { clients, loading, refreshClients } = useClientContext();
  const router = useRouter();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [kind, setKind] = useState<ClientKind>("client");
  const kindReady = clients.some((c) => "kind" in c); // 0032 컬럼이 있을 때만 협력사로 만들 수 있다
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [partnerId, setPartnerId] = useState("");
  const partners = clients.filter((c) => clientKind(c) === "partner");
  const partnerLinks = Object.fromEntries(clients.map((c) => [c.id, clientPartnerLinks(services, c.id, partners)]));
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");

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
    .filter((c) => (q.trim() ? c.name.toLowerCase().includes(q.trim().toLowerCase()) : true))
    .filter((c) => kind === "partner" || matchesServiceChannel(services, c.id, channel, partnerId));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">고객/협력사</h1>

        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder={`새 ${label} 이름`}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep"
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
      {warnings.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
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
          협력사 설정을 불러오지 못했습니다. 새로고침해 주세요.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="운영 상태" value={filter} onChange={(e) => setFilter(e.target.value as "active" | "all")} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
          <option value="active">운영중</option><option value="all">모든 상태</option>
        </select>
        {kind === "client" && <>
          <div role="group" aria-label="거래 경로" className="flex gap-1 rounded-lg bg-subtle p-1">
            {([["all", "전체"], ["direct", "직접"], ["partner", "협업"]] as const).map(([key, text]) => <button key={key} aria-pressed={channel === key} onClick={() => { setChannel(key); if (key !== "partner") setPartnerId(""); }} className={`rounded-md px-3 py-1 text-sm ${channel === key ? "bg-surface font-semibold text-accent-deep" : "text-muted hover:text-ink"}`}>{text}</button>)}
          </div>
          {channel === "partner" && <select aria-label="협력사 필터" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="max-w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"><option value="">모든 협력사</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        </>}
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
          {counts[kind] === 0 ? `${label}가 없습니다. 위에 이름을 적고 만들어 보세요.${kind === "partner" ? " 기존 고객사는 기본정보에서 구분을 협력사로 바꾸면 옮겨집니다." : ""}` : `조건에 맞는 ${label}가 없습니다.`}
        </p>
      ) : kind === "partner" ? (
        <div className="divide-y divide-border rounded-lg bg-surface">{visible.map((partner) => {
          const linked = services.filter((s) => s.partner_id === partner.id);
          return <Link key={partner.id} href={clientPath(partner.id, "overview")} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-subtle"><strong className="text-sm text-ink">{partner.name}</strong><span className="text-sm text-muted">진행 {linked.filter((s) => s.status === "active").length} · 전체 {linked.length}건 <span className="ml-3 text-accent-deep">협업 건 보기 →</span></span></Link>;
        })}</div>
      ) : (
        <ClientProgressTable partners={partnerLinks} title={false} clients={visible.map((client) => progress.find((row) => row.id === client.id) ?? buildWorkspaceProgress({ clients: [client], tasks: [], contents: [], services: [], profiles: [], now: 0 }).clients[0])} />
      )}
    </div>
  );
}
