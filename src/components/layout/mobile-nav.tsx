"use client";

import { useRef } from "react";
import { NavList } from "@/components/layout/sidebar";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type { Role } from "@/types/database";

/** The native dialog keeps keyboard focus inside the mobile navigation and supports Escape. */
export function MobileNav({ role }: { role: Role }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="md:hidden">
      <button onClick={() => dialog.current?.showModal()} aria-label="메뉴 열기" aria-haspopup="dialog" aria-controls="workspace-mobile-menu" className="flex size-9 items-center justify-center rounded-md border border-border text-ink hover:bg-subtle">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <dialog ref={dialog} id="workspace-mobile-menu" aria-label="워크스페이스 메뉴" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink backdrop:bg-black/30">
        <div className="flex h-full w-[min(290px,85vw)] flex-col bg-surface shadow-xl">
          <div className="flex h-20 shrink-0 items-center justify-between px-5">
            <span className="text-[28px] font-bold tracking-[-1.4px]">RIDIWEB</span>
            <button onClick={() => dialog.current?.close()} aria-label="메뉴 닫기" className="grid size-10 place-items-center rounded-md text-xl text-muted hover:bg-subtle">×</button>
          </div>
          <WorkspaceSwitcher onNavigate={() => dialog.current?.close()} />
          <NavList role={role} onNavigate={() => dialog.current?.close()} />
        </div>
      </dialog>
    </div>
  );
}
