"use client";
import Link from "next/link";
import type { PendingAction } from "@/lib/assistant/action-types";
import styles from "./assistant-widget.module.css";

const statusLabel = { pending: "확인 대기", succeeded: "반영 완료", cancelled: "취소됨", failed: "반영 실패", expired: "기한 만료" };
export function ActionCard({ action, busy, onResolve }: { action: PendingAction; busy: boolean; onResolve: (action: PendingAction, decision: "confirm" | "cancel" | "edit") => void }) {
  const pending = action.status === "pending";
  return <article className={styles.actionCard} aria-label={`${action.display.title} ${statusLabel[action.status]}`}>
    <div className={styles.actionHeading}><strong>{action.display.title}</strong><span>{statusLabel[action.status]}</span></div>
    <dl>{action.display.fields.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    {action.display.note && <p className={styles.actionNote}>{action.display.note}</p>}
    {pending ? <>
      <p className={styles.actionNote}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false }).format(new Date(action.expires_at))}까지 확인</p>
      <div className={styles.actionButtons}>
        <button type="button" disabled={busy} onClick={() => onResolve(action, "confirm")}>확인 후 반영</button>
        <button type="button" disabled={busy} onClick={() => onResolve(action, "edit")}>수정하기</button>
        <button type="button" disabled={busy} onClick={() => onResolve(action, "cancel")}>취소</button>
      </div>
    </> : <p className={styles.actionNote} role="status">{action.result?.message}</p>}
    {action.status === "succeeded" && action.result?.href && /^\/moai\/[0-9a-f-]{36}$/i.test(action.result.href) && <Link className={styles.actionNote} href={action.result.href}>모아이 모임 열기 ↗</Link>}
  </article>;
}
