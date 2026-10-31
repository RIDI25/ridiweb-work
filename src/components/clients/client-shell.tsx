"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useClientContext } from "@/components/providers/client-context";
import { CLIENT_TABS, clientPath, parseClientPath } from "@/lib/nav";
import { getService } from "@/lib/services";
import type { ClientService } from "@/types/database";

/**
 * 고객사 카드의 틀 — 머리(이름·계약·상태)와 탭. 주소의 고객사를 '선택 고객사'로 맞춘 뒤에만 안쪽 화면을 그린다.
 * 기존 화면(플랜·생성·라이브러리·리포트·트래커)은 선택 고객사를 읽으므로 그대로 안에 넣을 수 있다.
 */
export function ClientShell({ id, children }: { id: string; children: ReactNode }) {
  const { clients, selectedClientId, setSelectedClientId, loading } = useClientContext();
  const pathname = usePathname();
  const tab = parseClientPath(pathname)?.tab ?? "overview";
  const client = clients.find((c) => c.id === id) ?? null;

  useEffect(() => {
    if (!loading && client && selectedClientId !== id) setSelectedClientId(id);
  }, [id, client, loading, selectedClientId, setSelectedClientId]);

  const [services, setServices] = useState<{ id: string; rows: ClientService[] }>({ id: "", rows: [] });
  useEffect(() => {
    let active = true;
    createClient()
      .from("client_services")
      .select("*")
      .eq("client_id", id)
      .order("created_at")
      .then(({ data }) => {
        if (active) setServices({ id, rows: (data ?? []) as ClientService[] });
      });
    return () => {
      active = false;
    };
  }, [id]);
  const activeServices = services.id === id ? services.rows.filter((s) => s.status === "active") : [];

  if (!loading && !client) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">고객사를 찾을 수 없습니다.</p>
        <Link href="/clients" className="text-sm text-accent-deep hover:underline">
          고객사 목록으로
        </Link>
      </div>
    );
  }
  const synced = !!client && selectedClientId === id;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-xs text-muted">
          <Link href="/clients" className="hover:underline">
            고객사
          </Link>{" "}
          › {client?.name ?? "…"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{client?.name ?? "불러오는 중…"}</h1>
          {client?.is_internal && (
            <span className="rounded bg-subtle px-1.5 py-0.5 text-xs font-medium text-muted">내부</span>
          )}
          {client && client.status !== "active" && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {client.status === "paused" ? "일시중지" : "종료"}
            </span>
          )}
          {activeServices.map((s) => {
            const def = getService(s.service_type);
            return (
              <span
                key={s.id}
                title={def?.description ?? s.service_type}
                className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-accent-deep"
              >
                {def ? `${def.emoji} ${def.label}` : s.service_type}
              </span>
            );
          })}
          {services.id === id && activeServices.length === 0 && (
            <Link href={clientPath(id, "info")} className="text-xs text-muted hover:text-accent-deep hover:underline">
              진행중 계약 없음 · 기본정보에서 등록
            </Link>
          )}
          <Link href={clientPath(id, "info")} className="ml-auto text-xs text-accent-deep hover:underline">
            ✎ 기본정보 수정
          </Link>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {CLIENT_TABS.map((t) => (
          <Link
            key={t.key}
            href={clientPath(id, t.key)}
            className={[
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "border-accent text-accent-deep" : "border-transparent text-muted hover:text-ink",
            ].join(" ")}
          >
            {t.icon ? `${t.icon} ` : ""}
            {t.label}
          </Link>
        ))}
      </div>

      <div key={id}>{synced ? children : <p className="text-sm text-muted">불러오는 중…</p>}</div>
    </div>
  );
}
