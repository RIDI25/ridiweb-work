/**
 * Primary navigation: assistant → calendar → meetings → clients → SEO/GEO → finance.
 * Search performance routes stay client-scoped and belong to the SEO/GEO section.
 * Legacy URLs remain available for existing links and bookmarks.
 */
export type NavIconName = "chat" | "calendar" | "notes" | "clients" | "search" | "wallet" | "lecture";

export interface NavItem {
  href: string;
  label: string;
  /** 상위 메뉴의 href. 없으면 최상위 항목 */
  parent?: string;
  /** 통일된 선 아이콘 */
  icon?: NavIconName;
  /** 보조 메뉴(아래쪽 작은 글씨) */
  aux?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/assistant", label: "비서 채팅", icon: "chat" },
  { href: "/schedule", label: "캘린더", icon: "calendar" },
  { href: "/", label: "오늘 할 일", parent: "/schedule" },
  { href: "/tasks", label: "업무 보드", parent: "/schedule" },
  { href: "/meetings", label: "회의록", icon: "notes" },
  { href: "/lectures", label: "강의", icon: "lecture" },
  { href: "/lectures/library", label: "커리큘럼 · 기본 자료", parent: "/lectures" },
  { href: "/lectures/profile", label: "강사 소개 · 이력", parent: "/lectures" },
  { href: "/clients", label: "고객/협력사", icon: "clients" },
  { href: "/sales", label: "영업 관리", parent: "/clients" },
  { href: "/quotes", label: "견적서 · 계약서", parent: "/clients" },
  { href: "/seo-geo", label: "SEO/GEO", icon: "search" },
  { href: "/diagnosis", label: "사이트 진단", parent: "/seo-geo" },
  { href: "/revenue", label: "정산", icon: "wallet" },
  { href: "/ledger", label: "입출금 장부", parent: "/revenue" },
  { href: "/settings", label: "설정", aux: true },
  { href: "/daily", label: "데일리 소식", aux: true },
];

/** 고객사 카드의 탭. /clients/[id]/[key] */
export interface ClientTab {
  key: "overview" | "content" | "seo" | "geo" | "reports" | "info";
  label: string;
  icon?: string;
}

export const CLIENT_TABS: ClientTab[] = [
  { key: "overview", label: "개요" },
  { key: "content", label: "콘텐츠" },
  { key: "seo", label: "SEO", icon: "🔎" },
  { key: "geo", label: "GEO", icon: "✨" },
  { key: "reports", label: "서치콘솔 · GA4", icon: "📊" },
  { key: "info", label: "기본정보" },
];

/** 콘텐츠 탭 안의 보기 (?view=). 왼쪽 메뉴 콘텐츠 아래에도 그대로 펼친다 (2026-09-18: 키워드 리서치를 못 찾는다는 요청) */
export type ContentView = "work" | "plans" | "generate" | "library" | "keywords";
export const CONTENT_VIEWS: { key: ContentView; label: string; hint: string }[] = [
  { key: "work", label: "작업 목록", hint: "다섯 상태 · 다음 행동" },
  { key: "plans", label: "플랜 · 일정", hint: "기획 → 예정일 → 외부 글 등록" },
  { key: "generate", label: "글 만들기", hint: "AI 생성 → 수정 → 완료 처리" },
  { key: "library", label: "라이브러리 · 검수", hint: "승인 · 발행 기록" },
  { key: "keywords", label: "키워드 리서치", hint: "네이버·구글 키워드 분석 — 주제 발굴" },
];

export function clientPath(clientId: string, tab: ClientTab["key"] = "overview", query?: string): string {
  return `/clients/${clientId}/${tab}${query ? `?${query}` : ""}`;
}

/** 현재 경로에서 고객사 카드 안인지와 어느 탭인지 */
export function parseClientPath(pathname: string): { clientId: string; tab: ClientTab["key"] | null } | null {
  const m = pathname.match(/^\/clients\/([^/]+)(?:\/([^/?]+))?/);
  if (!m) return null;
  const tab = CLIENT_TABS.find((t) => t.key === m[2])?.key ?? null;
  return { clientId: m[1], tab };
}

/** 옛 주소 → 고객사 카드 탭 (쿼리는 그대로 넘긴다) */
export const LEGACY_ROUTES: Record<string, { tab: ClientTab["key"]; view?: string }> = {
  "/keywords": { tab: "content", view: "keywords" },
  "/plans": { tab: "content", view: "plans" },
  "/generate": { tab: "content", view: "generate" },
  "/library": { tab: "content", view: "library" },
  "/reports": { tab: "reports" },
  "/tracking": { tab: "geo" },
};

/** A client URL has one primary section, even though its page keeps the client tabs. */
export function getNavSection(pathname: string): string | null {
  const client = parseClientPath(pathname);
  if (client) return ["seo", "geo", "reports"].includes(client.tab ?? "") ? "/seo-geo" : "/clients";
  const item = NAV_ITEMS.find(entry => pathname === entry.href || (entry.href !== "/" && pathname.startsWith(`${entry.href}/`)));
  return item?.parent ?? item?.href ?? null;
}
