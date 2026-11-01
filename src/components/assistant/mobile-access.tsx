"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./mobile-access.module.css";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const assistantUrl = "https://ridiweb-work.vercel.app/assistant";

export function MobileAccess() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [platform, setPlatform] = useState<"iphone" | "android">("iphone");
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const complete = () => { setInstallPrompt(null); setInstalled(true); setMessage("홈 화면에 추가됐어요."); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    return () => { window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("appinstalled", complete); };
  }, []);

  function open() {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    setPlatform(/Android/i.test(navigator.userAgent) ? "android" : "iphone");
    setMessage(""); dialog.current?.showModal();
  }
  async function install() {
    if (!installPrompt || busy) return;
    setBusy(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setMessage(choice.outcome === "accepted" ? "설치를 요청했어요. 완료되면 홈 화면에서 열어 주세요." : "아래 안내로 나중에 추가할 수 있어요.");
    } catch { setMessage("아래 브라우저 메뉴 안내를 이용해 주세요."); }
    finally { setInstallPrompt(null); setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(assistantUrl); setMessage("주소를 복사했어요."); }
    catch { setMessage("아래 주소를 길게 눌러 복사해 주세요."); }
  }

  return <>
    <button ref={trigger} type="button" className={styles.trigger} onClick={open} aria-haspopup="dialog" aria-label="휴대폰에서 사용">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 5h4M11 19h2" /></svg><span>휴대폰</span>
    </button>
    <dialog ref={dialog} aria-labelledby="mobile-access-title" className={styles.dialog} onClose={() => trigger.current?.focus()} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} onCancel={(event) => event.stopPropagation()} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className={styles.heading}><h2 id="mobile-access-title">휴대폰에서 비서 쓰기</h2><button type="button" onClick={() => dialog.current?.close()} aria-label="설치 안내 닫기">×</button></div>
      <p>같은 RIDIWEB 계정으로 로그인하면 대화를 이어볼 수 있어요.</p>
      <div className={styles.address}><a href={assistantUrl}>{assistantUrl.replace("https://", "")}</a><button type="button" onClick={() => void copy()}>주소 복사</button></div>
      {installed ? <p className={styles.installed}>홈 화면 앱으로 사용 중이에요.</p> : <>
        {installPrompt && <button type="button" className={styles.install} disabled={busy} onClick={() => void install()}>{busy ? "설치 확인 중…" : "홈 화면에 추가"}</button>}
        <div className={styles.platforms} role="group" aria-label="휴대폰 종류"><button type="button" aria-pressed={platform === "iphone"} onClick={() => setPlatform("iphone")}>아이폰</button><button type="button" aria-pressed={platform === "android"} onClick={() => setPlatform("android")}>안드로이드</button></div>
        {platform === "iphone" ? <ol><li>Safari에서 위 주소 열기</li><li>공유 메뉴 → 홈 화면에 추가</li><li>‘웹 앱으로 열기’가 보이면 켜고 추가</li></ol> : <ol><li>Chrome에서 위 주소 열기</li><li>메뉴 ⋮ → 홈 화면에 추가 또는 앱 설치</li><li>추가한 RIDIWEB 아이콘 열기</li></ol>}
      </>}
      <p className={styles.note}>채팅에는 인터넷 연결이 필요해요. 알림 기능은 아직 연결되지 않았어요.</p>
      {message && <p role="status" className={styles.feedback}>{message}</p>}
    </dialog>
  </>;
}
