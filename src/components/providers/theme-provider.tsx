"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

type Theme = "light" | "dark";
const KEY = "ridiweb.theme", EVENT = "ridiweb:theme";
let memory: Theme | null = null;
function snapshot(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* The in-memory preference still works with blocked storage. */ }
  return memory ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function subscribe(notify: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", notify);
  window.addEventListener(EVENT, notify);
  media.addEventListener("change", notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(EVENT, notify);
    media.removeEventListener("change", notify);
  };
}
const ThemeContext = createContext<Theme>("light");
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "light" as Theme);
  useEffect(() => { document.documentElement.dataset.theme = snapshot(); }, [theme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useContext(ThemeContext);
  function toggle() {
    memory = theme === "dark" ? "light" : "dark";
    try { window.localStorage.setItem(KEY, memory); } catch { /* Session-only fallback. */ }
    document.documentElement.dataset.theme = memory;
    window.dispatchEvent(new Event(EVENT));
  }
  return <button type="button" onClick={toggle} aria-label="다크모드" aria-pressed={theme === "dark"} title={theme === "dark" ? "라이트모드로 전환" : "다크모드로 전환"} className={`flex items-center gap-2.5 rounded-lg p-2.5 text-sm text-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${compact ? "shrink-0" : "w-full text-left"}`}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{theme === "dark" ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></> : <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>}</svg>
    {!compact && <><span className="flex-1">다크모드</span><span className="text-xs">{theme === "dark" ? "켬" : "끔"}</span></>}
  </button>;
}
