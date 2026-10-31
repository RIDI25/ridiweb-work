"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import styles from "./workspace-shell.module.css";

export function WorkspaceShell({ header, children }: { header: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [pathname]);

  const fullPage = pathname === "/assistant";
  return (
    <div className={styles.shell}>
      <a href="#workspace-main" className={styles.skip}>본문으로 이동</a>
      <div className={styles.header}>{header}</div>
      <main id={fullPage ? undefined : "workspace-main"} ref={main} className={styles.main} hidden={fullPage}>{children}</main>
      <div id={fullPage ? "workspace-main" : undefined} role={fullPage ? "main" : undefined} className={fullPage ? styles.chatPage : styles.chatDock} hidden={!fullPage && !open}>
        <AssistantWidget fullPage={fullPage} onClose={() => setOpen(false)} />
      </div>
      {!fullPage && <button className={styles.launcher} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={open ? "비서 채팅 닫기" : "비서 채팅 열기"}><span aria-hidden>{open ? "×" : "✦"}</span><span>{open ? "닫기" : "비서"}</span></button>}
    </div>
  );
}
