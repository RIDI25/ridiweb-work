import { NAV_ITEMS, type NavItem } from "./nav";
export const WORKSPACES = {
  optify: { label: "옵티파이", home: "/", description: "고객 업무" },
  moai: { label: "모아이", home: "/moai", description: "모임 운영" },
  lectures: { label: "강의", home: "/lectures", description: "외부 강의" },
} as const;
export type WorkspaceId = keyof typeof WORKSPACES;
export function isWorkspace(value: unknown): value is WorkspaceId { return typeof value === "string" && Object.hasOwn(WORKSPACES,value); }
const within = (path:string,root:string) => path===root || path.startsWith(`${root}/`);
/** A deep link decides the workspace; shared screens retain the last choice. */
export function workspaceForPath(path:string): WorkspaceId | null {
  if(within(path,"/lectures")) return "lectures";
  if(within(path,"/moai")) return "moai";
  if(path==="/" || ["/clients","/tasks","/meetings","/sales","/quotes","/seo-geo","/diagnosis","/revenue","/ledger","/daily","/plans","/generate","/library","/keywords","/reports","/tracking"].some(p=>within(path,p))) return "optify";
  return null;
}
const common: NavItem[] = [
  { href:"/assistant",label:"비서 채팅",icon:"chat" },
  { href:"/schedule",label:"통합 캘린더",icon:"calendar" },
];
const settings: NavItem[] = [{href:"/settings",label:"설정",aux:true}];
export function workspaceNav(workspace:WorkspaceId): NavItem[] {
  if(workspace==="lectures") return [...common,
    {href:"/lectures",label:"강의 현황",icon:"lecture"},
    {href:"/lectures/library",label:"커리큘럼 · 자료",icon:"notes"},
    {href:"/lectures/profile",label:"강사 소개 · 이력",icon:"clients"},...settings];
  if(workspace==="moai") return [...common,
    {href:"/moai",label:"모임 운영",icon:"clients"},
    {href:"/moai/templates",label:"운영 양식",icon:"notes"},...settings];
  return [...common,
    {href:"/",label:"오늘 할 일",icon:"notes"},
    {href:"/tasks",label:"업무 보드",parent:"/"},
    ...NAV_ITEMS.filter(item=>!["/assistant","/schedule","/","/tasks"].includes(item.href)&&!within(item.href,"/lectures"))];
}
