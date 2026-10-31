"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { parseClientPath } from "@/lib/nav";
import { useClientContext } from "@/components/providers/client-context";
import { ActionCard } from "./action-card";
import type { PendingAction } from "@/lib/assistant/action-types";
import styles from "./assistant-widget.module.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  context?: string;
  actions?: { name: string; ok: boolean; summary: string }[];
}

export function AssistantWidget({ expanded, onToggleExpanded }: { expanded: boolean; onToggleExpanded: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clients } = useClientContext();
  const screenClientId = parseClientPath(pathname)?.clientId;
  const [target, setTarget] = useState("auto");
  const selectedId = target === "auto" ? screenClientId : target;
  const selected = clients.find((client) => client.id === selectedId);
  const targetMissing = (target === "auto" ? !!screenClientId : target !== "all") && !selected;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [actionError, setActionError] = useState("");
  const [resolving, setResolving] = useState(false);
  const actionLock = useRef(false);
  const sending = useRef(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, busy, pendingActions]);

  async function loadActions() {
    try {
      const response = await fetch("/api/assistant/actions", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "확인 초안을 불러오지 못했어요.");
      setPendingActions((previous) => {
        const merged = new Map(previous.map((action) => [action.id, action]));
        for (const action of data.actions ?? []) merged.set(action.id, action);
        return [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
      setActionError(data.more ? "확인할 초안이 많아 일부만 표시합니다. 처리 후 목록을 다시 불러와 주세요." : "");
    } catch (error) { setActionError(error instanceof Error ? error.message : "확인 초안을 불러오지 못했어요."); }
  }
  useEffect(() => { void loadActions(); }, []);

  async function resolveAction(action: PendingAction, decision: "confirm" | "cancel" | "edit") {
    if (actionLock.current) return;
    actionLock.current = true; setResolving(true); setActionError("");
    try {
      const response = await fetch("/api/assistant/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: action.id, decision: decision === "edit" ? "cancel" : decision }) });
      const data = await response.json();
      if (!response.ok || !data.action) throw new Error(data.error || "처리 결과를 확인하지 못했어요. 목록을 다시 불러와 주세요.");
      const updated = data.action as PendingAction;
      setPendingActions((previous) => previous.map((item) => item.id === updated.id ? updated : item));
      if (updated.status === "succeeded") {
        router.refresh();
        setMessages((previous) => [...previous, { role: "assistant", content: `${action.display.title}: ${updated.result?.message ?? "반영 완료"}` }]);
      }
      if (decision === "edit" && updated.status === "cancelled") {
        setInput(`이 내용으로 새 초안을 만들어줘.\n${action.display.title}\n${action.display.fields.map((field) => `${field.label}: ${field.value}`).join("\n")}\n수정할 내용: `);
        document.getElementById("assistant-input")?.focus();
      }
    } catch (error) { setActionError(error instanceof Error ? error.message : "처리 결과를 확인하지 못했어요. 목록을 다시 불러와 주세요."); }
    finally { actionLock.current = false; setResolving(false); }
  }

  async function send(text = input) {
    text = text.trim();
    if (!text || sending.current || targetMissing) return;
    const context = selected?.name ?? "전체 업무";
    const next: ChatMessage[] = [...messages, { role: "user", content: text, context }];
    sending.current = true;
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-20).map((message) => ({
          role: message.role,
          content: message.role === "user" && message.context !== "전체 업무"
            ? `업무 대상 고객: ${message.context}\n${message.content}` : message.content,
        })) }),
      });
      if (response.status === 401 || response.status === 403) throw new Error("로그인 상태를 확인한 뒤 다시 요청해 주세요.");
      if (!response.ok) throw new Error("요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
      const data = await response.json();
      setMessages((previous) => [...previous, { role: "assistant", context,
        content: data.ok ? data.text : `처리하지 못했어요: ${data.error ?? "다시 확인해 주세요."}`,
        actions: data.actions,
      }]);
      if (data.pendingActions?.length) setPendingActions((previous) => {
        const merged = new Map(previous.map((action) => [action.id, action]));
        for (const action of data.pendingActions) merged.set(action.id, action);
        return [...merged.values()];
      });
    } catch (error) {
      setMessages((previous) => [...previous, { role: "assistant", context, content: error instanceof Error ? error.message : "연결을 확인한 뒤 다시 시도해 주세요." }]);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <aside className={styles.panel} aria-label="옵티파이 비서">
      <header className={styles.header}>
        <h2><span aria-hidden className={styles.spark}>✦</span> 옵티파이 비서</h2>
        <button type="button" className={styles.expand} onClick={onToggleExpanded} aria-expanded={expanded} aria-controls="assistant-log">{expanded ? "대화 작게" : "대화 크게"}</button>
      </header>
      <div className={styles.context}>
        <label htmlFor="assistant-target">업무 대상</label>
        <select id="assistant-target" value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="auto">현재 화면 · {clients.find((client) => client.id === screenClientId)?.name ?? (screenClientId ? "고객 확인 중" : "전체 업무")}</option>
          <option value="all">전체 업무</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </div>
      <div id="assistant-log" ref={log} className={styles.log} role="log" aria-label="비서와의 대화" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && <div className={styles.welcome}>
          <strong>업무도 기획도 함께 정리해요.</strong>
          <p>회의록과 연결된 옵시디언 노트를 참고해 기획을 함께 다듬고, 업무·일정·정산도 처리할 수 있어요. 고객을 옮겨도 대화는 이어집니다.</p>
          <div className={styles.suggestions}>
            <button type="button" disabled={targetMissing || busy} onClick={() => void send("오늘 확인할 업무를 알려줘")}>오늘 확인할 업무 알려줘</button>
            <button type="button" onClick={() => setInput("고객 미팅 제안서 구성을 같이 잡아보자. 목표와 고객 상황부터 한 가지씩 확인해줘.")}>제안서 기획 함께하기 →</button>
            <button type="button" onClick={() => setInput("이 고객 점검 업무를 동생에게 내일까지 맡겨줘")}>점검 업무를 동생에게 맡기기 →</button>
            <button type="button" onClick={() => setInput("옵시디언의 비서봇 기획을 찾아보고, 최근 결정한 내용과 다음에 정할 일을 정리해줘.")}>옵시디언 기획 이어가기 →</button>
          </div>
        </div>}
        {messages.map((message, index) => <article key={index} className={`${styles.message} ${message.role === "user" ? styles.user : ""}`}>
          <div className={styles.messageLabel}>{message.role === "user" ? "나" : "옵티파이 비서"}<span>{message.context}</span></div>
          <p>{message.content}</p>
          {!!message.actions?.length && <ul className={styles.actions}>{message.actions.map((action, actionIndex) => <li key={actionIndex}><span>{action.ok ? "조회" : "확인 필요"}</span> {action.summary}</li>)}</ul>}
        </article>)}
        {actionError && <div className={styles.actionError} role="alert"><p>{actionError}</p><button type="button" disabled={resolving} onClick={() => void loadActions()}>초안 목록 다시 불러오기</button></div>}
        {pendingActions.filter((action) => action.status === "pending").map((action) => <ActionCard key={action.id} action={action} busy={resolving} onResolve={resolveAction} />)}
        {pendingActions.some((action) => action.status !== "pending") && <details className={styles.actionHistory}><summary>최근 처리 기록</summary>{pendingActions.filter((action) => action.status !== "pending").slice(-10).reverse().map((action) => <ActionCard key={action.id} action={action} busy={resolving} onResolve={resolveAction} />)}</details>}
        {resolving && <p className={styles.pending} role="status">확인한 내용을 처리하고 있어요…</p>}
        {busy && <p className={styles.pending} role="status">요청을 처리하고 있어요…</p>}
      </div>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label htmlFor="assistant-input">비서에게 바로 요청하기</label>
        <textarea id="assistant-input" value={input} maxLength={4000} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} rows={3} placeholder="예: 고객 미팅 제안서 구성을 같이 잡아보자" />
        <div className={styles.compose}><span>Enter 전송 · Shift+Enter 줄바꿈</span><button type="submit" disabled={busy || targetMissing || !input.trim()}>보내기</button></div>
      </form>
    </aside>
  );
}
