"use client";

import Link from "next/link";
import { Suspense, useId, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CONTENT_VIEWS, clientPath, getNavSection, parseClientPath, type ClientTab } from "@/lib/nav";
import { useClientContext } from "@/components/providers/client-context";
import { CLIENT_KIND_LABEL, clientKind, type Role } from "@/types/database";
import { workspaceNav } from "@/lib/workspaces";
import { useWorkspace } from "@/components/providers/workspace-context";
import { WorkspaceSwitcher, WorkspaceHomeLink } from "./workspace-switcher";
import { NavIcon } from "./nav-icon";
import styles from "./sidebar.module.css";

function SubLink({ href, label, active, onNavigate }: { href: string; label: string; active: boolean; onNavigate?: () => void }) {
  return <Link href={href} className={styles.subLink} aria-current={active ? "page" : undefined} onClick={onNavigate}>{label}</Link>;
}

function ContentViewLinks({ clientId, onNavigate }: { clientId: string; onNavigate?: () => void }) {
  const params = useSearchParams();
  const raw = params.get("view");
  const current = CONTENT_VIEWS.some(view => view.key === raw) ? raw : "work";
  return <div className={styles.contentViews}>{CONTENT_VIEWS.map(view => <SubLink key={view.key} href={clientPath(clientId, "content", `view=${view.key}`)} label={view.label} active={current === view.key} onNavigate={onNavigate} />)}</div>;
}

const clientLinks: { tab: ClientTab["key"]; label: string }[] = [
  { tab: "overview", label: "고객 개요" },
  { tab: "content", label: "콘텐츠 작업" },
  { tab: "info", label: "고객 정보" },
];
const searchLinks: { tab: ClientTab["key"]; label: string }[] = [
  { tab: "seo", label: "SEO · 검색 순위" },
  { tab: "geo", label: "GEO · AI 노출" },
  { tab: "reports", label: "검색 유입 · 분석" },
];

/** Keep client-specific links under the section that owns the current work. */
function ClientLinks({ search, onNavigate }: { search: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clients, selectedClientId, setSelectedClientId, loading } = useClientContext();
  const inClient = parseClientPath(pathname);
  const links = search ? searchLinks : clientLinks;
  const clientId = inClient?.clientId ?? selectedClientId;
  const current = clients.find(client => client.id === clientId);
  const pickerId = useId();
  if (!search && !inClient) return null;
  if (loading) return <p className={styles.loading}>고객을 불러오고 있어요…</p>;
  return <div className={styles.clientBlock}>
    <label htmlFor={pickerId}>{search ? "확인할 고객" : "선택한 고객"}</label>
    <select id={pickerId} value={current?.id ?? ""} onChange={event => {
      const nextId = event.target.value;
      setSelectedClientId(nextId);
      if (inClient) {
        const tab = links.some(link => link.tab === inClient.tab) ? inClient.tab! : links[0].tab;
        router.push(clientPath(nextId, tab));
        onNavigate?.();
      }
    }}>
      {!current && <option value="" disabled>고객을 선택해 주세요</option>}
      {(["client", "partner"] as const).map(kind => {
        const group = clients.filter(client => clientKind(client) === kind);
        return group.length ? <optgroup key={kind} label={CLIENT_KIND_LABEL[kind]}>{group.map(client => <option key={client.id} value={client.id}>{client.name}{client.is_internal ? " (내부)" : ""}</option>)}</optgroup> : null;
      })}
    </select>
    {current ? links.map(link => <div key={link.tab}>
      <SubLink href={clientPath(current.id, link.tab)} label={link.label} active={inClient?.tab === link.tab && inClient.clientId === current.id} onNavigate={onNavigate} />
      {!search && link.tab === "content" && inClient?.tab === "content" && <ContentViewLinks clientId={current.id} onNavigate={onNavigate} />}
    </div>) : <SubLink href="/clients" label="고객 목록에서 확인하기" active={false} onNavigate={onNavigate} />}
  </div>;
}

function NavListInner({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const items = workspaceNav(workspace);
  const activeSection = getNavSection(pathname, items);
  const [expanded, setExpanded] = useState<{ pathname: string; section: string | null } | null>(null);
  const openSection = expanded?.pathname === pathname ? expanded.section : activeSection;
  const navId = useId();
  const inClient = parseClientPath(pathname);
  const matches = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return <nav aria-label="주 메뉴" className={styles.nav}>
    {items.filter(item => !item.parent && !item.aux).map(item => {
      const children = items.filter(child => child.parent === item.href);
      const hasChildren = children.length > 0;
      const open = hasChildren && openSection === item.href;
      const submenuId = `${navId}-${item.href.slice(1)}`;
      return <div key={item.href} className={styles.group}>
        <div className={styles.menuRow} data-active={activeSection === item.href}>
          <Link href={item.href} className={styles.mainLink} aria-current={pathname === item.href ? "page" : undefined} onClick={() => { setExpanded({ pathname, section: item.href }); onNavigate?.(); }}>
            {item.icon && <NavIcon name={item.icon} />}<span>{item.label}</span>
          </Link>
          {hasChildren && <button className={styles.toggle} aria-label={`${item.label} 하위 메뉴 ${open ? "접기" : "펼치기"}`} aria-expanded={open} aria-controls={submenuId} onClick={() => setExpanded({ pathname, section: open ? null : item.href })}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="m6 4 4 4-4 4" /></svg>
          </button>}
        </div>
        {hasChildren && <div id={submenuId} className={styles.subMenu} hidden={!open}>
          {item.href === "/seo-geo" && open && <ClientLinks search onNavigate={onNavigate} />}
          {children.map(child => <SubLink key={child.href} href={child.href} label={child.label} active={matches(child.href)} onNavigate={onNavigate} />)}
          {item.href === "/clients" && open && inClient && <ClientLinks search={false} onNavigate={onNavigate} />}
        </div>}
      </div>;
    })}
    <div className={styles.aux}>{items.filter(item => item.aux).map(item => <SubLink key={item.href} href={item.href} label={item.label} active={matches(item.href)} onNavigate={onNavigate} />)}</div>
  </nav>;
}

/** Desktop and mobile share the same menu order, grouping, and current section. */
export function NavList(props: { role?: Role; onNavigate?: () => void }) {
  return <Suspense fallback={null}><NavListInner onNavigate={props.onNavigate} /></Suspense>;
}
export function Sidebar({ role, footer }: { role: Role; footer: ReactNode }) {
  return (
    <aside aria-label="워크스페이스 메뉴" className="flex h-full min-h-0 flex-col border-r border-border bg-surface">
      <WorkspaceHomeLink className="mx-6 mb-5 mt-7 block w-fit shrink-0 leading-none focus-visible:outline-2 focus-visible:outline-accent">
        <span className="block text-[31px] font-bold tracking-[-1.5px]">RIDIWEB</span>
        <span className="mt-2 block text-[11px] tracking-[.18em] text-muted">workspace</span>
      </WorkspaceHomeLink>
      <WorkspaceSwitcher />
      <NavList role={role} />
      <div className="shrink-0 border-t border-border px-3 py-3">{footer}</div>
    </aside>
  );
}
