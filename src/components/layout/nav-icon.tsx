import type { NavIconName } from "@/lib/nav";

const paths: Record<NavIconName, React.ReactNode> = {
  lecture: <><path d="M3 4h18v12H3zM12 16v5m-5 0 5-5 5 5M7 8h10M7 12h6" /></>,
  chat: <><path d="M20 11.5a8 8 0 0 1-8 8H4l-1 2v-10a8.5 8.5 0 0 1 17 0Z" /><path d="M8 10h7M8 14h4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18M7 15h2m6 0h2M7 18h2" /></>,
  notes: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6m-6 4h6m-6 4h4" /></>,
  clients: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5M6 12l3-3 3 2 3-4" /></>,
  wallet: <><path d="M4 7h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2l12-2v4" /><path d="M21 11h-5v6h5m-2.5-3h.01" /></>,
};

export function NavIcon({ name }: { name: NavIconName }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}
