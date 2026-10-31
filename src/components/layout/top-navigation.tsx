"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS, clientPath, parseClientPath } from "@/lib/nav";
import { useClientContext } from "@/components/providers/client-context";

const linkClass = (active: boolean) => `rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${active ? "bg-tint text-accent-deep" : "text-muted hover:bg-subtle hover:text-ink"}`;

export function TopNavigation() {
  const pathname = usePathname();
  const matches = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="주 메뉴" className="flex min-w-0 flex-wrap items-center gap-1">
      {NAV_ITEMS.filter((item) => !item.parent && !item.aux).map((item) => {
        const active = matches(item.href) || NAV_ITEMS.some((sub) => sub.parent === item.href && matches(sub.href));
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={linkClass(active)}>{item.label}</Link>;
      })}
    </nav>
  );
}

/** Keep former sidebar destinations reachable in the matching section. */
export function SectionNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { clients, loading } = useClientContext();
  const inClient = parseClientPath(pathname);
  const item = NAV_ITEMS.find((item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)));
  const parent = item?.parent ?? item?.href;
  const links = NAV_ITEMS.filter((entry) => entry.href === parent || entry.parent === parent);
  if (inClient) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-4 py-2.5 sm:px-6">
        <label htmlFor="workspace-client" className="text-sm text-muted">고객사</label>
        <select id="workspace-client" value={inClient.clientId} disabled={loading} onChange={(event) => router.push(clientPath(event.target.value, inClient.tab ?? "overview"))} className="min-w-0 max-w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium">
          {!clients.some((client) => client.id === inClient.clientId) && <option value={inClient.clientId}>불러오는 중…</option>}
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.is_internal ? " (내부)" : ""}</option>)}
        </select>
        <Link href="/clients" className="text-sm text-accent-deep hover:underline">전체 고객</Link>
      </div>
    );
  }
  if (links.length < 2) return null;
  return <nav aria-label="현재 메뉴의 하위 메뉴" className="flex flex-wrap gap-2 border-t border-border bg-surface px-4 py-2 sm:px-6">{links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} className={linkClass(pathname === link.href)}>{link.label}</Link>)}</nav>;
}
