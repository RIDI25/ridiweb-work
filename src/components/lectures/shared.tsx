"use client";
import { useEffect } from "react";
import Link from "next/link";
import styles from "./lectures.module.css";
export async function lectureApi(url:string, values?:unknown, method="POST") {
 const res=await fetch(url,{cache:"no-store",...(values?{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(values)}:{})});
 const data=await res.json();if(!res.ok)throw new Error(data.error||"연결을 확인하고 다시 시도해 주세요.");return data;
}
export function useUnsaved(dirty:boolean){
 useEffect(()=>{
  if(!dirty)return;
  const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();};
  const click=(e:MouseEvent)=>{const a=(e.target as Element).closest?.("a");if(a?.href&&a.target!=="_blank"&&!a.hasAttribute("download")&&!a.href.includes("/api/lectures/export")&&a.href!==window.location.href&&!window.confirm("저장하지 않은 변경이 있어요. 저장하지 않고 이동할까요?")){e.preventDefault();e.stopPropagation();}};
  window.addEventListener("beforeunload",unload);document.addEventListener("click",click,true);
  return()=>{window.removeEventListener("beforeunload",unload);document.removeEventListener("click",click,true);};
 },[dirty]);
}
export function LectureNav({active}:{active:"projects"|"library"|"profile"}){return <nav className={styles.tabs} aria-label="강의 메뉴"><Link aria-current={active==="projects"?"page":undefined} href="/lectures">강의 현황</Link><Link aria-current={active==="library"?"page":undefined} href="/lectures/library">커리큘럼 · 기본 자료</Link><Link aria-current={active==="profile"?"page":undefined} href="/lectures/profile">강사 소개 · 이력</Link></nav>;}
export function Notice({error,message}:{error?:string;message?:string}){return <>{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.notice}>{message}</p>}</>;}
export function DocumentPreview({body}:{body:string}){return <div className={styles.preview}>{body.split("\n").map((line,i)=>line.startsWith("### ")?<h4 key={i}>{line.slice(4)}</h4>:line.startsWith("## ")?<h3 key={i}>{line.slice(3)}</h3>:line.startsWith("# ")?<h2 key={i}>{line.slice(2)}</h2>:<p key={i}>{line||"\u00a0"}</p>)}</div>;}
