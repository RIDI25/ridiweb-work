"use client";

import Link from "next/link";
import { ASSISTANT_MODEL, SPECIALIST_MODEL, SPECIALIST_ROLES } from "@/lib/ai-models";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveClient } from "@/lib/actions/settings";
import type { Client, Profile, Role } from "@/types/database";

export function SettingsView({ role, aiConnected }: { role: Role; aiConnected: { fable: boolean; astra: boolean } }) {
  const isOwner = role === "owner";
  /** null = 고객사 목록, 값 = 해당 고객사 상세 설정 */
  const [newName, setNewName] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [usage, setUsage] = useState<
    { provider: string; count: number; cost: number }[]
  >([]);

  const reload = () => {
    const supabase = createClient();
    supabase
      .from("clients")
      .select("*")
      .order("is_internal", { ascending: false })
      .then(({ data }) => setClients((data ?? []) as Client[]));
  };

  useEffect(() => {
    const supabase = createClient();
    reload();
    supabase
      .from("profiles")
      .select("*")
      .then(({ data }) => setProfiles((data ?? []) as Profile[]));
    const d = new Date();
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    supabase
      .from("api_usage_logs")
      .select("provider, estimated_cost_usd")
      .gte("created_at", monthStart)
      .then(({ data }) => {
        const map: Record<string, { count: number; cost: number }> = {};
        for (const r of (data ?? []) as {
          provider: string;
          estimated_cost_usd: number | null;
        }[]) {
          const m = (map[r.provider] ??= { count: 0, cost: 0 });
          m.count++;
          m.cost += Number(r.estimated_cost_usd) || 0;
        }
        setUsage(
          Object.entries(map).map(([provider, v]) => ({ provider, ...v })),
        );
      });
  }, []);

  // ── 목록: 고객사 선택 + 팀원·API 사용량 ───────────────────
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">설정 (팀 · 연동 · 사용량)</h1>
        {!isOwner && (
          <p className="mt-1 rounded-md bg-tint px-3 py-1.5 text-sm text-accent-deep">
            멤버 권한은 조회만 가능합니다. 편집은 관리자(owner) 전용입니다.
          </p>
        )}
      </div>

      <section className="rounded-xl border border-border bg-surface p-5" aria-label="비서 팀 기본 설정">
        <h2 className="text-lg font-bold text-ink">비서 팀 기본 설정</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Fable이 방향을 잡고, Astra가 역할별 실무를 수행해요. 결과를 검토한 Fable이 답변하고, 업무 변경은 내가 최종 확인해요.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-subtle p-4"><strong>총괄 · Claude Fable 5.1</strong><p className="mt-2 text-sm text-muted">전체 기획 · 비서 대화 · 우선순위 · 최종 답변</p><p className="mt-2 text-xs text-muted">{ASSISTANT_MODEL} · {aiConnected.fable ? "연결 키 설정됨" : "연결 키 필요"}</p></div>
          <div className="rounded-lg bg-subtle p-4"><strong>실무 · GPT-6 Astra</strong><p className="mt-2 text-sm text-muted">{Object.values(SPECIALIST_ROLES).map(role => role.label).join(" · ")}</p><p className="mt-2 text-xs text-muted">{SPECIALIST_MODEL} · {aiConnected.astra ? "연결 키 설정됨" : "연결 키 필요"}</p></div>
        </div>
      </section>

      {/* 고객사 목록 — 옵티파이(내부)가 최상단 */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">고객사 목록</h2>
        <p className="text-xs text-muted">계약·채널·워드프레스·온보딩은 각 고객사 카드의 기본정보 탭에서 고칩니다.</p>
        <div className="overflow-hidden rounded-lg border border-border">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}/info`}
              className="flex w-full items-center justify-between border-b border-border bg-surface px-4 py-3 text-left last:border-b-0 hover:bg-tint/40"
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{c.name}</span>
                {c.is_internal && (
                  <span className="rounded bg-tint px-1.5 py-0.5 text-[11px] font-medium text-accent-deep">
                    내부
                  </span>
                )}
                <span
                  className={[
                    "rounded px-1.5 py-0.5 text-[11px]",
                    c.status === "active"
                      ? "bg-subtle text-muted"
                      : "bg-amber-50 text-amber-700",
                  ].join(" ")}
                >
                  {c.status === "active" ? "운영중" : c.status === "paused" ? "일시중지" : "종료"}
                </span>
              </span>
              <span className="text-xs text-muted">기본정보 →</span>
            </Link>
          ))}
          {clients.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">고객사가 없습니다.</p>
          )}
        </div>
        {isOwner && (
          <div className="flex gap-2 rounded-lg border border-dashed border-border p-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="새 고객사 이름"
              className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep"
            />
            <button
              onClick={async () => {
                if (!newName.trim()) return;
                const r = await saveClient(null, { name: newName.trim() });
                if (r.ok) {
                  setNewName("");
                  reload();
                }
              }}
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink hover:opacity-90"
            >
              추가
            </button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">팀원</h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">역할</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 text-ink">{p.name}</td>
                  <td className="px-3 py-2 text-muted">같은 권한</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink">API 사용량 (이번 달)</h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">제공자</th>
                <th className="px-3 py-2 text-right">호출 수</th>
                <th className="px-3 py-2 text-right">추정 비용(USD)</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.provider} className="border-t border-border">
                  <td className="px-3 py-2 text-ink">{u.provider}</td>
                  <td className="px-3 py-2 text-right font-mono">{u.count}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    ${u.cost.toFixed(2)}
                  </td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted">
                    이번 달 사용 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
