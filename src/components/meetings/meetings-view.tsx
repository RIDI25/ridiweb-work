"use client";

import { useEffect, useRef, useState } from "react";
import { MEETING_TEMPLATE, meetingMarkdown, type MeetingNote, type NoteHit, type VaultState } from "@/lib/notes";
import styles from "./meetings.module.css";

type Draft = Pick<MeetingNote, "title" | "meeting_date" | "client_id" | "participants" | "body" | "archived"> & { id?: string; version?: number };
type VaultNote = { id: string; title: string; path: string; body: string; vault_name: string; source_modified_at: string };
const newDraft = (): Draft => ({ title: "", meeting_date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), client_id: null, participants: "", body: MEETING_TEMPLATE, archived: false });
const time = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "불러오지 못했어요. 다시 시도해 주세요.");
  return data;
}

export function MeetingsView({ userId, clients, clientsError, initialId }: { userId: string; clients: { id: string; name: string }[]; clientsError: boolean; initialId?: string }) {
  const [tab, setTab] = useState<"meetings" | "vault">("meetings");
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [hits, setHits] = useState<NoteHit[]>([]);
  const [checkedAt, setCheckedAt] = useState(0);
  const [sync, setSync] = useState<VaultState | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [client, setClient] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [vaultNote, setVaultNote] = useState<VaultNote | null>(null);
  const [organized, setOrganized] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const selection = useRef(0);
  const storageKey = `optify-meeting-draft:${userId}`;

  useEffect(() => {
    // Restore this tab’s external draft after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const raw = sessionStorage.getItem(storageKey); if (raw) setRecovery(JSON.parse(raw)); } catch { /* storage can be unavailable */ }
  }, [storageKey]);
  useEffect(() => {
    if (!dirty || !draft) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* beforeunload remains available */ }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draft, storageKey]);
  useEffect(() => {
    const abort = new AbortController();
    // The request lifecycle depends on filters and explicit refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError("");
    const params = new URLSearchParams({ q: search, client, archived: String(archived), page: String(page) });
    request(tab === "meetings" ? `/api/meetings?${params}` : `/api/knowledge?q=${encodeURIComponent(search)}`, { signal: abort.signal })
      .then(data => { if (tab === "meetings") { setNotes(data.notes); setCount(data.count); } else { setHits(data.notes); setSync(data.state); setCheckedAt(Date.now()); } })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [tab, search, client, archived, page, revision]);
  useEffect(() => {
    if (tab !== "vault") return;
    const timer = window.setInterval(() => setRevision(v => v + 1), 60000);
    return () => window.clearInterval(timer);
  }, [tab]);
  useEffect(() => {
    if (!initialId) return;
    const abort = new AbortController();
    request(`/api/meetings?id=${encodeURIComponent(initialId)}`, { signal: abort.signal }).then(data => setDraft(data.note)).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [initialId]);

  function clearRecovery() { try { sessionStorage.removeItem(storageKey); } catch {} setRecovery(null); }
  function canLeave() { return !dirty || window.confirm("저장하지 않은 수정 내용을 닫을까요? 현재 내용은 이 탭의 임시 초안으로 남아요."); }
  async function openNote(id: string, source: "meetings" | "vault") {
    if (busy || !canLeave()) return;
    const ticket = ++selection.current;
    setError(""); setNotice(""); setBusy(true);
    try {
      const data = await request(`/api/${source === "meetings" ? "meetings" : "knowledge"}?id=${id}`);
      if (ticket !== selection.current) return;
      setDirty(false); setOrganized("");
      if (source === "meetings") setDraft(data.note); else setVaultNote(data.note);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function edit(values: Partial<Draft>) { setDraft(current => current && { ...current, ...values }); setDirty(true); setNotice(""); }
  async function save(archiveValue = draft?.archived) {
    if (!draft || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const data = await request("/api/meetings", { method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, archived: archiveValue }) });
      setDraft(data.note); setDirty(false); setOrganized(""); clearRecovery(); setRevision(v => v + 1);
      setNotice(archiveValue ? "보관함에 옮겼어요. 언제든 복원할 수 있어요." : "회의록을 저장했어요. 비서도 이 내용을 검색할 수 있어요.");
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function organize() {
    if (!draft || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { const data = await request("/api/meetings/organize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draft.body }) }); setOrganized(data.body); }
    catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  function download() {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([meetingMarkdown(draft, clients.find(c => c.id === draft.client_id)?.name)], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${draft.meeting_date} ${draft.title || "회의록"}`.replace(/[\\/:*?"<>|]/g, "-") + ".md"; a.click(); URL.revokeObjectURL(url);
  }
  function switchTab(next: "meetings" | "vault") { if (busy || !canLeave()) return; setTab(next); setDraft(null); setVaultNote(null); setDirty(false); setSearch(""); setQuery(""); setPage(0); setError(""); setNotice(""); }

  return <div className={styles.root}>
    <header className={styles.heading}><div><span className={styles.eyebrow}>대화에서 다음 행동까지</span><h1>회의록</h1><p>함께 정한 내용과, 이어서 할 일을 한곳에.</p></div><button className={styles.primary} disabled={busy} onClick={() => { if (canLeave()) { setTab("meetings"); setDraft(newDraft()); setDirty(false); setOrganized(""); setNotice(""); setError(""); } }}>＋ 회의록 작성</button></header>
    <div className={styles.tabs}><button aria-pressed={tab === "meetings"} disabled={busy} onClick={() => switchTab("meetings")}>팀 회의록</button><button aria-pressed={tab === "vault"} disabled={busy} onClick={() => switchTab("vault")}>내 옵시디언 자료</button></div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {recovery && !dirty && <div className={styles.recovery}>저장하지 않은 임시 초안이 있어요. <button disabled={busy} onClick={() => { setDraft(recovery); setTab("meetings"); setDirty(true); setRecovery(null); }}>이어서 작성</button><button onClick={clearRecovery}>초안 지우기</button></div>}
    {tab === "vault" && <section className={styles.connection} aria-label="옵시디언 연결 상태"><strong>{loading && !sync ? "연결 상태 확인 중…" : sync?.error ? "연결 확인이 필요해요" : sync?.last_success_at && checkedAt - Date.parse(sync.last_success_at) > 300000 ? "맥의 다음 연결을 기다리고 있어요" : sync?.last_success_at ? `${sync.vault_name} · ${sync.note_count}개 노트` : "아직 연결된 볼트가 없어요"}</strong><p>{sync?.last_success_at ? `마지막 반영 ${time(sync.last_success_at)} · 맥이 켜져 있고 인터넷에 연결되면 약 1분마다 확인해요.` : "이 계정에 연결된 맥의 옵시디언 자료를 표시합니다."}</p>{sync?.error && <p role="alert">{sync.error}</p>}{!!sync?.skipped_count && <p>크기 제한 등으로 {sync.skipped_count}개 파일은 제외됐어요.</p>}<small>내 계정에서만 조회 · 기존 노트는 옵시디언에서 수정 · Markdown 노트 검색</small></section>}
    <div className={styles.toolbar}><form onSubmit={e => { e.preventDefault(); setSearch(query); setPage(0); }}><input aria-label={tab === "meetings" ? "회의 제목 검색" : "볼트 전체 검색"} value={query} maxLength={120} onChange={e => setQuery(e.target.value)} placeholder={tab === "meetings" ? "회의 제목으로 찾기" : "예: 비서봇, 제안서, 옵티파이"} /><button>검색</button></form>{tab === "meetings" && <><select aria-label="고객사 필터" value={client} onChange={e => { setClient(e.target.value); setPage(0); }}><option value="">모든 고객사</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><label className={styles.check}><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPage(0); }} /> 보관함</label></>}<button disabled={loading} onClick={() => setRevision(v => v + 1)}>새로고침</button></div>
    <div className={styles.layout}>
      <section className={styles.list} aria-label={tab === "meetings" ? "회의록 목록" : "옵시디언 검색 결과"}>
        <div className={styles.listLabel}>{loading ? "불러오는 중…" : tab === "meetings" ? `${count}개의 회의록` : `${hits.length}개의 검색 결과 · 최대 30개`}</div>
        {!loading && !error && !(tab === "meetings" ? notes : hits).length && <div className={styles.empty}><strong>{search ? "검색 결과가 없어요" : tab === "meetings" ? "첫 회의를 기록해 보세요" : "연결된 노트를 여기서 찾아보세요"}</strong><p>{tab === "meetings" ? "짧은 메모부터 시작해도 좋아요. 비서가 결정 사항과 할 일로 정리해 드려요." : "키워드를 바꾸거나 맥의 연결 상태를 확인해 주세요."}</p></div>}
        {!loading && tab === "meetings" && notes.map(note => <button className={styles.row} aria-pressed={draft?.id === note.id} key={note.id} disabled={busy} onClick={() => void openNote(note.id, "meetings")}><time>{note.meeting_date}</time><strong>{note.title}</strong><span>{clients.find(c => c.id === note.client_id)?.name || "내부 · 공통"}{note.participants && ` · ${note.participants}`}</span></button>)}
        {!loading && tab === "vault" && hits.map(hit => <button className={styles.row} aria-pressed={vaultNote?.id === hit.id} key={hit.id} disabled={busy} onClick={() => void openNote(hit.id, "vault")}><small>{hit.path}</small><strong>{hit.title}</strong><span className={styles.snippet}>{hit.excerpt}</span></button>)}
        {tab === "meetings" && count > 30 && <div className={styles.pagination}><button disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>이전</button><span>{page + 1} / {Math.ceil(count / 30)}</span><button disabled={(page + 1) * 30 >= count || loading} onClick={() => setPage(p => p + 1)}>다음</button></div>}
      </section>
      {tab === "meetings" ? draft ? <section className={styles.editor} aria-label="회의록 편집"><div className={styles.editorTop}><strong>{draft.id ? "회의록 편집" : "새 회의록"}</strong><span>{dirty ? "저장 전" : draft.id ? "저장됨" : "초안"}</span></div><fieldset disabled={busy}><label>회의 제목<input value={draft.title} maxLength={200} placeholder="예: 고객사 SEO 진단 결과 미팅" onChange={e => edit({ title: e.target.value })} /></label><div className={styles.fields}><label>날짜<input type="date" value={draft.meeting_date} onChange={e => edit({ meeting_date: e.target.value })} /></label><label>고객사<select value={draft.client_id || ""} disabled={clientsError} onChange={e => edit({ client_id: e.target.value || null })}><option value="">내부 · 공통</option>{clients.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label></div>{clientsError && <p role="alert">고객사를 불러오지 못했어요. 새로고침해 주세요.</p>}<label>참석자<input value={draft.participants} maxLength={1000} placeholder="이름 또는 역할" onChange={e => edit({ participants: e.target.value })} /></label><label>회의 내용<textarea className={styles.body} value={draft.body} maxLength={60000} onChange={e => edit({ body: e.target.value })} /></label><div className={styles.editorActions}><button type="button" disabled={!draft.body.trim() || draft.body.length > 30000} onClick={() => void organize()}>✦ 비서로 정리</button><button type="button" onClick={download}>Markdown 내려받기</button></div></fieldset><p className={styles.help}>비서 정리는 검토 후 적용해요. 후속 업무는 자동 등록하지 않아요. 내려받은 파일을 옵시디언 볼트에 넣으면 함께 검색돼요.</p>{organized && <div className={styles.suggestion}><h3>비서가 정리한 초안</h3><pre>{organized}</pre><button disabled={busy} onClick={() => { edit({ body: organized }); setOrganized(""); }}>이 내용으로 바꾸기</button><button disabled={busy} onClick={() => setOrganized("")}>원문 유지</button></div>}<footer className={styles.savebar}>{draft.id && <button disabled={busy} onClick={() => { if (draft.archived || window.confirm("이 회의록을 보관함으로 옮길까요?")) void save(!draft.archived); }}>{draft.archived ? "보관 해제" : "보관함으로"}</button>}<button className={styles.primary} disabled={busy || !draft.title.trim() || !draft.meeting_date} onClick={() => void save()}>{busy ? "처리 중…" : "회의록 저장"}</button></footer></section> : <section className={styles.placeholder}><span aria-hidden>↗</span><h2>회의의 맥락을 남겨요.</h2><p>회의록을 선택하거나 새로 작성해 보세요.<br />저장한 내용은 오른쪽 비서에게 물어볼 수 있어요.</p></section> : vaultNote ? <section className={styles.editor} aria-label="옵시디언 노트"><div className={styles.editorTop}><strong>내 옵시디언 자료</strong><span>읽기 전용</span></div><h2>{vaultNote.title}</h2><p className={styles.path}>{vaultNote.path}</p><a className={styles.openLink} href={`obsidian://open?vault=${encodeURIComponent(vaultNote.vault_name)}&file=${encodeURIComponent(vaultNote.path)}`}>옵시디언에서 열기 ↗</a><pre className={styles.noteBody}>{vaultNote.body}</pre></section> : <section className={styles.placeholder}><span aria-hidden>⌕</span><h2>생각과 기획을 이어서.</h2><p>전체 볼트에서 노트를 찾아보세요.<br />비서에게 “옵시디언의 비서봇 기획을 참고해 줘”라고 요청해도 좋아요.</p></section>}
    </div>
  </div>;
}
