"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useClientContext } from "@/components/providers/client-context";
import { saveClient } from "@/lib/actions/settings";
import { ClientProgressTable } from "@/components/today/progress-board";
import { buildWorkspaceProgress, type ClientProgress } from "@/lib/workspace-progress";
import { clientPath } from "@/lib/nav";
import { CLIENT_KIND_LABEL, clientKind, type ClientKind } from "@/types/database";

/** 고객사 목록 — 실제 업무·검수 기록과 다음 행동을 함께 보여준다. */
export function ClientsIndex({ progress, warnings }: { progress: ClientProgress[]; warnings: string[] }) {
  const { clients, loading, refreshClients } = useClientContext();
  const router = useRouter();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [kind, setKind] = useState<ClientKind>("client");
  const kindReady = clients.some((c) => "kind" in c); // 0032 컬럼이 있을 때만 협력사로 만들 수 있다
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
    .filter((c) => (q.trim() ? c.name.includes(q.trim()) : true));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">고객/협력사</h1>
          <p className="mt-1 text-sm text-muted">진행 상황과 다음 행동을 함께 확인하세요.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder={`새 ${label} 이름 (이름만 있으면 됩니다)`}
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
          협력사 구분 칸이 아직 없습니다. supabase/migrations/0032_client_kind.sql 을 SQL Editor 에서 실행하면 협력사를 만들고 옮길 수 있습니다.
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
          {counts[kind] === 0 ? `${label}가 없습니다. 위에 이름을 적고 만들어 보세요.${kind === "partner" ? " 기존 고객사는 기본정보에서 구분을 협력사로 바꾸면 옮겨집니다." : ""}` : `조건에 맞는 ${label}가 없습니다.`}
        </p>
      ) : (
        <ClientProgressTable title={false} clients={visible.map((client) => progress.find((row) => row.id === client.id) ?? buildWorkspaceProgress({ clients: [client], tasks: [], contents: [], services: [], profiles: [], now: 0 }).clients[0])} />
      )}
    </div>
  );
}
