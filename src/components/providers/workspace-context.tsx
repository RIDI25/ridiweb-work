"use client";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isWorkspace, workspaceForPath, type WorkspaceId } from "@/lib/workspaces";
const KEY="ridiweb.workspace", EVENT="ridiweb:workspace";
function subscribe(notify:()=>void){window.addEventListener("storage",notify);window.addEventListener(EVENT,notify);return()=>{window.removeEventListener("storage",notify);window.removeEventListener(EVENT,notify);};}
let memory:WorkspaceId="optify";
function snapshot():WorkspaceId {try{const saved=window.localStorage.getItem(KEY);return isWorkspace(saved)?saved:memory;}catch{return memory;}}
function remember(workspace:WorkspaceId){memory=workspace;try{window.localStorage.setItem(KEY,workspace);}catch{}window.dispatchEvent(new Event(EVENT));}
const RestrictedContext=createContext(false);
export function useRestrictedWorkspace(){return useContext(RestrictedContext);}
const WorkspaceContext=createContext<WorkspaceId>("optify");
export function WorkspaceProvider({children,restricted=false}:{children:ReactNode;restricted?:boolean}){
 const pathname=usePathname();
 const previous=useSyncExternalStore(subscribe,snapshot,()=>"optify" as WorkspaceId);
 const routed=workspaceForPath(pathname);
 const workspace=restricted?"moai":routed||previous;
 useEffect(()=>{document.documentElement.dataset.workspace=workspace;},[workspace]);
 useEffect(()=>{if(routed)remember(routed);},[routed]);
 return <RestrictedContext.Provider value={restricted}><WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider></RestrictedContext.Provider>;
}
export function useWorkspace(){return useContext(WorkspaceContext);}
