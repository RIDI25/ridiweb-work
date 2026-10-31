"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import styles from "./workspace-shell.module.css";

export function WorkspaceShell({ header, children }: { header: ReactNode; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const main = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [pathname]);

  return (
    <div className={`${styles.shell} ${expanded ? styles.expanded : ""}`}>
      <a href="#workspace-main" className={styles.skip}>본문으로 이동</a>
      <div className={styles.header}>{header}</div>
      <main id="workspace-main" ref={main} className={styles.main}>{children}</main>
      <AssistantWidget expanded={expanded} onToggleExpanded={() => setExpanded((value) => !value)} />
    </div>
  );
}
