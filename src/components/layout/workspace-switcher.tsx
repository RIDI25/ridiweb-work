"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { WORKSPACES, type WorkspaceId } from "@/lib/workspaces";
import { useWorkspace } from "@/components/providers/workspace-context";
import styles from "./sidebar.module.css";
export function WorkspaceSwitcher({onNavigate}:{onNavigate?:()=>void}){
 const current=useWorkspace();
 return <nav aria-label="워크스페이스 선택" className={styles.switcher}>{(Object.keys(WORKSPACES) as WorkspaceId[]).map(key=><Link key={key} href={WORKSPACES[key].home} aria-current={current===key?"true":undefined} onClick={onNavigate}>{WORKSPACES[key].label}</Link>)}</nav>;
}
export function WorkspaceHomeLink({children,className}:{children:ReactNode;className?:string}){
 const current=useWorkspace();
 return <Link href={WORKSPACES[current].home} aria-label="RIDIWEB 홈" className={className}>{children}</Link>;
}
