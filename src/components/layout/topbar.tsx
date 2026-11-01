import Link from "next/link";
import { WorkspaceHomeLink } from "./workspace-switcher";
import { signOut } from "@/lib/actions/auth";
import { MobileNav } from "./mobile-nav";
import type { Role } from "@/types/database";

export function UserMenu({ userName, side = false }: { userName: string; side?: boolean }) {
  return (
    <details className={`relative shrink-0 ${side ? "w-full" : "ml-auto"}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-subtle" aria-hidden>{userName.slice(0, 1)}</span>
        <span className="flex-1">{userName}</span><span className="text-muted" aria-hidden>{side ? "⌃" : "⌄"}</span>
      </summary>
      <div className={`absolute z-50 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg ${side ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"}`}>
        <Link href="/settings" className="block rounded-md px-3 py-2.5 text-sm hover:bg-subtle">설정</Link>
        <Link href="/daily" className="block rounded-md px-3 py-2.5 text-sm hover:bg-subtle">데일리 소식</Link>
        <form action={signOut} className="mt-1 border-t border-border pt-1"><button type="submit" className="w-full rounded-md px-3 py-2.5 text-left text-sm text-muted hover:bg-subtle">로그아웃</button></form>
      </div>
    </details>
  );
}

/** Narrow screens use a compact menu button; desktop navigation stays on the left. */
export function Topbar({ userName, role }: { userName: string; role: Role }) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-surface px-3">
      <MobileNav role={role} />
      <WorkspaceHomeLink className="text-[25px] font-bold leading-none tracking-[-1.2px]">RIDIWEB</WorkspaceHomeLink>
      <UserMenu userName={userName} />
    </header>
  );
}
