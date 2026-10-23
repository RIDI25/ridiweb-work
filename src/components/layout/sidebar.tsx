"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CLIENT_TABS, CONTENT_VIEWS, NAV_ITEMS, clientPath, parseClientPath, type NavItem } from "@/lib/nav";
import { useClientContext } from "@/components/providers/client-context";
import { CLIENT_KIND_LABEL, clientKind, type Role } from "@/types/database";

/**
 * 왼쪽 메뉴 — 질문 다섯 개(오늘·고객사·영업·정산·일정) + 보조.
 * 고객사 카드 안에 있으면 '고객사' 아래에 고객사 선택과 탭(개요·콘텐츠·SEO·GEO·서치콘솔·GA4·기본정보)이 펼쳐지고,
 * 콘텐츠 아래에는 다섯 보기(작업 목록·플랜·글 만들기·라이브러리·키워드 리서치)가 항상 보인다.
 */
function NavLink({
  item,
  active,
  sub,
  onNavigate,
}: {
  item: { href: string; label: string; icon?: string };
  active: boolean;
  sub?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        "flex items-center gap-2 rounded-md transition-colors",
        sub ? "ml-6 px-2.5 py-1 text-[13px]" : "px-2.5 py-1.5 text-sm font-semibold",
        active ? "bg-tint text-accent-deep" : sub ? "text-muted hover:bg-subtle hover:text-ink" : "text-ink hover:bg-subtle",
      ].join(" ")}
    >
      {item.icon && !sub && (
        <span className="w-5 shrink-0 text-center text-[14px]" aria-hidden>
          {item.icon}
        </span>
      )}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/** 콘텐츠 탭 아래 다섯 보기. current 가 없으면 강조 없이 */
function ContentViewList({ clientId, current, onNavigate }: { clientId: string; current: string | null; onNavigate?: () => void }) {
  return (
    <div className="mb-0.5 ml-4 border-l border-accent/25 pl-1.5">
      {CONTENT_VIEWS.map((v) => {
        const active = current === v.key;
        return (
          <Link
            key={v.key}
            href={clientPath(clientId, "content", `view=${v.key}`)}
            onClick={onNavigate}
            title={v.hint}
            className={["flex items-center rounded-md px-2 py-0.5 text-[12px]", active ? "bg-surface font-semibold text-accent-deep shadow-sm" : "text-muted hover:bg-surface/80 hover:text-ink"].join(" ")}
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}

/** 주소의 ?view= 로 지금 보기를 강조 (useSearchParams 는 Suspense 안에서만) */
function ContentViewLinks({ clientId, inContentTab, onNavigate }: { clientId: string; inContentTab: boolean; onNavigate?: () => void }) {
  const params = useSearchParams();
  const raw = params.get("view");
  const current = inContentTab ? (CONTENT_VIEWS.some((v) => v.key === raw) ? raw : "work") : null;
  return <ContentViewList clientId={clientId} current={current} onNavigate={onNavigate} />;
}

/** 고객사 카드 안: 고객사 선택 + 탭 */
function ClientBlock({ clientId, tab, onNavigate }: { clientId: string; tab: string | null; onNavigate?: () => void }) {
  const router = useRouter();
  const { clients, loading } = useClientContext();
  const current = clients.find((c) => c.id === clientId);
  return (
    <div className="ml-3 mt-1 rounded-lg border border-accent/30 bg-tint/60 p-1.5">
      {loading ? (
        <p className="px-2 py-1 text-xs text-muted">고객사 불러오는 중…</p>
      ) : (
        <select
          value={clientId}
          onChange={(e) => {
            router.push(clientPath(e.target.value, (tab as (typeof CLIENT_TABS)[number]["key"]) ?? "overview"));
            onNavigate?.();
          }}
          aria-label="고객사 선택"
          className="mb-1 w-full rounded-md border border-accent/40 bg-surface px-2 py-1.5 text-sm font-semibold text-accent-deep outline-none focus:border-accent"
        >
          {!current && <option value={clientId}>(고객사)</option>}
          {(["client", "partner"] as const).map((k) => {
            const group = clients.filter((c) => clientKind(c) === k);
            if (!group.length) return null;
            return (
              <optgroup key={k} label={CLIENT_KIND_LABEL[k]}>
                {group.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_internal ? " (내부)" : ""}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      )}
      {CLIENT_TABS.map((t) => {
        const active = tab === t.key;
        return (
          <div key={t.key}>
            <Link
              href={clientPath(clientId, t.key)}
              onClick={onNavigate}
              className={[
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]",
                active ? "bg-surface font-semibold text-accent-deep shadow-sm ring-1 ring-accent/30" : "text-ink hover:bg-surface/80",
              ].join(" ")}
            >
              {t.icon && (
                <span className="w-4 text-center text-[12px]" aria-hidden>
                  {t.icon}
                </span>
              )}
              {t.label}
            </Link>
            {t.key === "content" && (
              <Suspense fallback={<ContentViewList clientId={clientId} current={null} onNavigate={onNavigate} />}>
                <ContentViewLinks clientId={clientId} inContentTab={active} onNavigate={onNavigate} />
              </Suspense>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NavListInner({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const inClient = parseClientPath(pathname);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const primaries = NAV_ITEMS.filter((i) => !i.parent && !i.aux);
  const subsOf = (href: string) => NAV_ITEMS.filter((i) => i.parent === href);
  const auxes = NAV_ITEMS.filter((i) => i.aux);
  /** 상위 항목은 자기 또는 하위 항목 경로에서 켜진다 */
  const primaryActive = (item: NavItem) =>
    isActive(item.href) || subsOf(item.href).some((s) => isActive(s.href)) || (item.href === "/clients" && !!inClient);

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {primaries.map((item) => (
        <div key={item.href}>
          <NavLink item={item} active={primaryActive(item)} onNavigate={onNavigate} />
          {item.href === "/clients" && inClient && (
            <ClientBlock clientId={inClient.clientId} tab={inClient.tab} onNavigate={onNavigate} />
          )}
          {subsOf(item.href).map((s) => (
            <NavLink key={s.href} item={s} active={isActive(s.href)} sub onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      <div className="pt-4">
        <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted">보조</p>
        {auxes.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={[
              "block rounded-md px-2.5 py-1 text-[13px]",
              isActive(item.href) ? "bg-tint text-accent-deep" : "text-muted hover:bg-subtle hover:text-ink",
            ].join(" ")}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** 데스크톱 사이드바·모바일 드로어 공용 메뉴 목록 (role 은 하위 호환용 — 2인 모두 같은 권한) */
export function NavList(props: { role?: Role; onNavigate?: () => void }) {
  return (
    <Suspense fallback={null}>
      <NavListInner onNavigate={props.onNavigate} />
    </Suspense>
  );
}

export function Sidebar({ role }: { role: Role }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="inline-block h-3 w-3 rounded-full bg-accent" aria-hidden />
        <span className="text-base font-bold tracking-tight text-ink">옵티파이 워크스페이스</span>
      </div>

      <NavList role={role} />

      <div className="border-t border-border px-5 py-3 text-xs text-muted">2인 팀 · 같은 권한</div>
    </aside>
  );
}
