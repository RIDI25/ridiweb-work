import Link from "next/link";
import { signOut } from "@/lib/actions/auth";
import { TopNavigation, SectionNavigation } from "./top-navigation";
import type { Role } from "@/types/database";

export function Topbar({ userName }: { userName: string; role: Role }) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 px-4 py-4 sm:px-6">
        <Link href="/" aria-label="옵티파이 워크스페이스 홈" className="shrink-0 leading-none">
          <span className="block text-[30px] font-bold tracking-[-1.5px]">optify</span>
          <span className="mt-2 block text-[11px] tracking-[.18em] text-muted">workspace</span>
        </Link>
        <div className="order-3 basis-full min-[1000px]:order-none min-[1000px]:flex-1 min-[1000px]:basis-auto"><TopNavigation /></div>
        <details className="relative ml-auto shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium hover:bg-subtle">
            <span className="grid size-9 place-items-center rounded-full border border-border bg-subtle" aria-hidden>{userName.slice(0, 1)}</span>
            <span>{userName}<span className="ml-2 text-muted" aria-hidden>⌄</span></span>
          </summary>
          <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg">
            <Link href="/settings" className="block rounded-md px-3 py-2.5 text-sm hover:bg-subtle">설정 · 팀 · 연동</Link>
            <Link href="/daily" className="block rounded-md px-3 py-2.5 text-sm hover:bg-subtle">데일리 소식</Link>
            <form action={signOut} className="mt-1 border-t border-border pt-1"><button type="submit" className="w-full rounded-md px-3 py-2.5 text-left text-sm text-muted hover:bg-subtle">로그아웃</button></form>
          </div>
        </details>
      </div>
      <SectionNavigation />
    </header>
  );
}
