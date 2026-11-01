"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { LectureDocument, LectureProject } from "@/lib/lectures/types";
import { DocumentWorkspace } from "./document-workspace";
import { lectureApi, LectureNav, Notice } from "./shared";
import s from "./lectures.module.css";
export function LectureLibrary({profile=false}:{profile?:boolean}){
 const [docs,setDocs]=useState<LectureDocument[]|null>(null),[history,setHistory]=useState<LectureProject[]>([]),[error,setError]=useState("");
 useEffect(()=>{let active=true;Promise.all([lectureApi("/api/lectures/documents"),profile?lectureApi("/api/lectures?history=true"):Promise.resolve({projects:[]})]).then(([d,p])=>{if(active){setDocs(d.documents);setHistory(p.projects.filter((p:LectureProject)=>p.history_verified));if(d.count>500)setError("최근 수정한 기본 자료 500개를 표시하고 있어요.");}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[profile]);
 return <div className={s.workspace}><header className={s.header}><div><span className={s.eyebrow}>RIDIWEB · LECTURES</span><h1>{profile?"강사 소개 · 이력":"커리큘럼 · 기본 자료"}</h1><p>{profile?"확인된 경력과 강의 실적을 모아 필요한 소개에 활용하세요.":"반복해서 쓰는 강의 프로그램과 문서를 준비해 두세요."}</p></div></header><LectureNav active={profile?"profile":"library"}/><Notice error={error}/>{docs?<DocumentWorkspace initialDocuments={docs.filter(d=>profile?d.kind==="profile":d.kind!=="profile")} library={docs} projectId={null} onlyProfile={profile}/>:!error&&<p>기본 자료를 불러오고 있어요…</p>}{profile&&<section className={`${s.section} ${s.rule}`}><h2>확인된 강의 이력</h2><p className={s.small}>강의 현황에서 진행 완료 후 ‘이력에 반영’을 선택한 강의입니다.</p>{history.length?history.map(p=><Link key={p.id} className={s.row} href={`/lectures/${p.id}`}><strong>{p.title}</strong><span>{p.organization||"기관 미정"}</span><span>{p.sessions.filter(s=>s.kind==="lecture").map(s=>s.date).filter(Boolean).join(" · ")||"날짜 미정"}</span></Link>):<p className={s.muted}>아직 확인된 강의 이력이 없어요. 과거 강의도 등록하고 확인 후 이력에 반영할 수 있어요.</p>}</section>}</div>;
}
