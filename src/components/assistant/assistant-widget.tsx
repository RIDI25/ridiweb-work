"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { parseClientPath } from "@/lib/nav";
import { useClientContext } from "@/components/providers/client-context";
import { ActionCard } from "./action-card";
import type { PendingAction } from "@/lib/assistant/action-types";
import styles from "./assistant-widget.module.css";

interface ChatMessage { id: string; role: "user" | "assistant"; content: string; context: string; created_at: string; metadata?: { actions?: { name: string; ok: boolean; summary: string }[] } }
interface Conversation { id: string; title: string; pinned: boolean; updated_at: string; active_turn_id: string | null; archived_at?: string | null }
interface Archive { week_start: string; status: string; saved_at: string | null; error: string | null; summary_path: string | null }
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init }); const data = await response.json();
  if (!response.ok) throw new Error(data.error || "연결을 확인하고 다시 시도해 주세요."); return data;
}
export function AssistantWidget({ fullPage, visible, onClose }: { fullPage: boolean; visible: boolean; onClose: () => void }) {
  const pathname = usePathname(); const router = useRouter(); const { clients } = useClientContext();
  const screenClientId = parseClientPath(pathname)?.clientId;
  const [target, setTarget] = useState("auto");
  const selectedId = target === "auto" ? screenClientId : target;
  const selected = clients.find(c => c.id === selectedId);
  const targetMissing = (target === "auto" ? !!screenClientId : target !== "all") && !selected;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [networkBusy, setNetworkBusy] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [archive, setArchive] = useState<Archive | null>(null);
  const [connected, setConnected] = useState(false);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [resolving, setResolving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const active = useRef<string | null>(null); const sending = useRef(false); const actionLock = useRef(false); const log = useRef<HTMLDivElement>(null);
  const busy = networkBusy || serverRunning || loading;
  const loadList = useCallback(async () => {
    const data = await api("/api/assistant/conversations"); setConversations(data.conversations); setArchive(data.archive); setConnected(!!data.connection?.last_success_at); setReady(true); return data.conversations as Conversation[];
  }, []);
  const loadConversation = useCallback(async (id: string, olderPage = 0) => {
    const [data, actions] = await Promise.all([api(`/api/assistant/conversations?id=${id}&page=${olderPage}`), api(`/api/assistant/actions?conversationId=${id}`)]);
    if (active.current !== id) return;
    if (data.conversation.archived_at) { active.current = null; setConversation(null); setMessages([]); setServerRunning(false); setPendingActions([]); setError("이 대화는 옵시디언에 보관되어 목록에서 정리됐어요."); await loadList(); return; }
    setConversation(data.conversation); setServerRunning(!!data.conversation.active_turn_id);
    setMessages(previous => olderPage ? [...new Map([...data.messages, ...previous].map((m: ChatMessage) => [m.id, m])).values()] : data.messages);
    setMore(data.more); setPage(olderPage); setPendingActions(actions.actions || []);
    return data;
  }, [loadList]);
  const initialize = useCallback(async () => {
    setLoading(true); setError("");
    try { const list = await loadList(); const id = active.current || [...list].sort((a,b) => b.updated_at.localeCompare(a.updated_at))[0]?.id; if (id) { active.current = id; await loadConversation(id); } }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [loadList, loadConversation]);
  // Hydrate saved conversations from the external store once the shell mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    if (visible && page === 0 && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, busy, pendingActions, page, visible, fullPage]);
  useEffect(() => {
    if (!serverRunning || !conversation) return;
    const timer = window.setInterval(() => { void loadConversation(conversation.id).catch(e => setError(e.message)); }, 3000);
    return () => window.clearInterval(timer);
  }, [serverRunning, conversation, loadConversation]);
  useEffect(() => {
    if (busy || resolving) return;
    const timer = window.setInterval(() => { void loadList().then(list => {
      if (active.current && (page === 0 || !list.some(c => c.id === active.current))) return loadConversation(active.current);
    }).catch(e => setError(e.message)); }, 60000);
    return () => window.clearInterval(timer);
  }, [busy, resolving, page, loadList, loadConversation]);
  async function choose(id: string) {
    if (busy || sending.current) return;
    if (input.trim() && !window.confirm("입력 중인 메시지를 비우고 다른 대화를 열까요?")) return;
    active.current = id; setLoading(true); setError(""); setInput(""); setShowHistory(false);
    try { await loadConversation(id); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  async function newConversation() {
    const data = await api("/api/assistant/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    active.current = data.conversation.id; setConversation(data.conversation); setMessages([]); setPendingActions([]); setPage(0); setMore(false); await loadList(); return data.conversation as Conversation;
  }
  async function startNew() {
    if (busy || sending.current) return;
    if (input.trim() && !window.confirm("입력 중인 메시지를 비우고 새 대화를 시작할까요?")) return;
    setLoading(true); setError(""); setInput(""); setShowHistory(false);
    try { await newConversation(); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  async function pin() {
    if (!conversation) return;
    try { const data = await api("/api/assistant/conversations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: conversation.id, pinned: !conversation.pinned }) }); setConversation(data.conversation); await loadList(); }
    catch (e) { setError((e as Error).message); }
  }
  async function send(text = input) {
    text = text.trim(); if (!text || sending.current || busy || targetMissing || !ready) return;
    sending.current = true; setNetworkBusy(true); setError("");
    const context = selected?.name || "전체 업무";
    try {
      const current = conversation || await newConversation();
      setInput("");
      const requestId = crypto.randomUUID();
      setMessages(previous => [...previous, { id: requestId, role: "user", content: text, context, created_at: new Date().toISOString() }]);
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: current.id, requestId, message: text, context }) });
      const data = await response.json();
      if (!response.ok && !data.pending) { setError(data.error || "요청 결과를 확인하지 못했어요."); setInput(text); }
      await loadConversation(current.id); await loadList();
    } catch {
      setError("연결이 끊겼어요. 대화를 다시 불러와 저장 여부를 확인해 주세요.");
      if (active.current) await loadConversation(active.current).catch(() => undefined);
    } finally { sending.current = false; setNetworkBusy(false); }
  }
  async function resolveAction(action: PendingAction, decision: "confirm" | "cancel" | "edit") {
    if (actionLock.current) return; actionLock.current = true; setResolving(true); setError("");
    try {
      const data = await api("/api/assistant/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: action.id, decision: decision === "edit" ? "cancel" : decision }) });
      const updated = data.action as PendingAction;
      setPendingActions(previous => previous.map(item => item.id === updated.id ? updated : item));
      if (updated.status === "succeeded") router.refresh();
      if (active.current) await loadConversation(active.current);
      if (decision === "edit" && updated.status === "cancelled") { setInput(`이 내용으로 새 초안을 만들어줘.\n${action.display.title}\n${action.display.fields.map(f => `${f.label}: ${f.value}`).join("\n")}\n수정할 내용: `); document.getElementById("assistant-input")?.focus(); }
    } catch (e) { setError((e as Error).message); }
    finally { actionLock.current = false; setResolving(false); }
  }
  return <section className={`${styles.panel} ${fullPage ? styles.fullPage : styles.popup}`} aria-label="옵티파이 비서" onKeyDown={event => { if (!fullPage && event.key === "Escape") onClose(); }}>
    <header className={styles.header}><div><h1><span aria-hidden className={styles.spark}>✦</span> 비서 채팅</h1></div><div className={styles.headerActions}>{!fullPage && <Link href="/assistant">크게 열기 ↗</Link>}{!fullPage && <button aria-label="비서 채팅 닫기" onClick={onClose}>✕</button>}</div></header>
    <div className={styles.chatLayout}>
      <aside className={`${styles.history} ${showHistory ? styles.historyOpen : ""}`} aria-label="저장된 대화">
        <button className={styles.historyClose} aria-label="대화 목록 닫기" onClick={() => setShowHistory(false)}>목록 닫기 ×</button>
        <button className={styles.newChat} disabled={busy} onClick={() => void startNew()}>＋ 새 대화</button>
        <p className={styles.historyLabel}>내 대화 · 자동 저장</p>
        <div className={styles.conversationList}>{conversations.map(item => <button key={item.id} aria-pressed={conversation?.id === item.id} disabled={busy} onClick={() => void choose(item.id)}><span>{item.pinned && "📌 "}{item.title}</span><small>{new Date(item.updated_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" })}{item.active_turn_id ? " · 답변 준비 중" : ""}</small></button>)}{!conversations.length && !loading && <p className={styles.emptyHistory}>첫 대화를 시작해 보세요.</p>}</div>
        <div className={styles.archiveInfo}><strong>매주 월요일 오전 9시</strong><p>지난주 요약과 원문을 내 볼트에 보관해요. 저장이 확인된 대화만 목록에서 정리하고, 고정한 대화는 남겨둬요.</p><small>{!connected ? "이 계정의 옵시디언 연결이 필요해요." : archive?.error ? "보관을 완료하지 못했어요. 대화는 그대로 남아 있어요." : archive?.saved_at ? `최근 보관 ${new Date(archive.saved_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}` : "맥이 켜지고 연결되면 실행 · 한국 시간"}</small><Link href="/meetings">옵시디언 자료 확인 ↗</Link></div>
      </aside>
      <div className={styles.chatMain}>
        <div className={styles.threadToolbar}>
        <div className={styles.threadBar}><button className={styles.historyToggle} onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory}>대화 목록</button><strong>{conversation?.title || "새로운 대화를 시작해요"}</strong>{conversation && <button disabled={loading} aria-pressed={conversation.pinned} onClick={() => void pin()}>{conversation.pinned ? "📌 고정됨" : "대화 고정"}</button>}<button disabled={networkBusy} aria-label="대화 새로고침" onClick={() => void initialize()}>↻</button></div>
        <div className={styles.context}><label htmlFor="assistant-target">업무 대상</label><select id="assistant-target" value={target} onChange={e => setTarget(e.target.value)}><option value="auto">현재 화면 · {clients.find(c => c.id === screenClientId)?.name || (screenClientId ? "고객 확인 중" : "전체 업무")}</option><option value="all">전체 업무</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        {error && <div role="alert" className={styles.actionError}>{error}<button disabled={networkBusy} onClick={() => void initialize()}>대화 다시 불러오기</button></div>}
        <div id="assistant-log" ref={log} className={styles.log} role="log" aria-label="비서와의 대화" aria-live="polite" aria-relevant="additions">
          {more && <button className={styles.older} disabled={busy} onClick={() => { if (conversation) void loadConversation(conversation.id, page + 1).catch(e => setError(e.message)); }}>이전 메시지 더 보기</button>}
          {!messages.length && !loading && <div className={styles.welcome}><span aria-hidden>✦</span><strong>오늘은 어떤 일을 함께할까요?</strong><p>회의록과 옵시디언 노트를 참고해 기획을 다듬고,<br />업무·일정·정산도 이어서 처리해요.</p><div className={styles.suggestions}><button disabled={busy || targetMissing} onClick={() => void send("오늘 확인할 업무를 알려줘")}>오늘 확인할 업무 알려줘</button><button onClick={() => setInput("고객 미팅 제안서 구성을 같이 잡아보자. 목표와 고객 상황부터 확인해줘.")}>제안서 기획 함께하기 →</button><button onClick={() => setInput("옵시디언의 비서봇 기획을 찾아보고, 최근 결정한 내용과 다음에 정할 일을 정리해줘.")}>옵시디언 기획 이어가기 →</button></div></div>}
          {messages.map(message => <article key={message.id} className={`${styles.message} ${message.role === "user" ? styles.user : ""}`}><div className={styles.messageLabel}>{message.role === "user" ? "나" : "옵티파이 비서"}<span>{message.role === "user" ? message.context : ""}</span><time>{new Date(message.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.content}</p>{!!message.metadata?.actions?.length && <ul className={styles.actions}>{message.metadata.actions.map((action,i) => <li key={i}><span>{action.ok ? "조회" : "확인 필요"}</span> {action.summary}</li>)}</ul>}</article>)}
          {pendingActions.filter(a => a.status === "pending").map(a => <ActionCard key={a.id} action={a} busy={resolving} onResolve={resolveAction} />)}
          {pendingActions.some(a => a.status !== "pending") && <details className={styles.actionHistory}><summary>이 대화의 처리 기록</summary>{pendingActions.filter(a => a.status !== "pending").slice(-10).reverse().map(a => <ActionCard key={a.id} action={a} busy={resolving} onResolve={resolveAction} />)}</details>}
          {(busy || resolving) && <p className={styles.pending} role="status">{loading ? "저장된 대화를 불러오고 있어요…" : resolving ? "확인한 내용을 처리하고 있어요…" : "요청을 저장하고 답변을 준비하고 있어요…"}</p>}
        </div>
        <form className={styles.form} onSubmit={e => { e.preventDefault(); void send(); }}><label htmlFor="assistant-input">비서에게 바로 요청하기</label><div className={styles.inputRow}><textarea id="assistant-input" value={input} maxLength={8000} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} rows={2} placeholder="업무를 부탁하거나, 기획을 함께 시작해 보세요." /><button type="submit" disabled={busy || targetMissing || !input.trim() || !ready}>보내기</button></div><p className={styles.compose}>대화 자동 저장 · Enter 전송 · Shift+Enter 줄바꿈</p></form>
      </div>
    </div>
  </section>;
}
