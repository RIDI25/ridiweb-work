import { requireProfile } from "@/lib/auth";
const templates=[
 ["모임 기획안","이번 달 주제·목적·대상·프로그램·예산·담당자","매회 새로 작성"],
 ["타임테이블","시간·프로그램·진행자·준비물","기본 순서에서 조정"],
 ["신청 명단 · 출석부","참가자·입금·대기·취소·회차별 출석","새 회차 기록으로 시작"],
 ["모임 기록지","진행 내용·주요 의견·현장 이슈·후속 할 일","같은 양식으로 기록"],
 ["참가자 설문지","만족도·운영 피드백·다음 주제 희망·주제별 질문","공통 질문과 이번 달 질문"],
 ["결과 정리","참석 현황·설문 결과·개선점·다음 회차 준비","모임 후 정리"],
];
export default async function MoaiTemplates(){await requireProfile();return <div className="mx-auto max-w-5xl space-y-8"><header><p className="text-sm font-semibold tracking-wider text-accent-deep">MOAI · 준비할 기본 양식</p><h1 className="mt-3 text-2xl font-bold tracking-tight">운영 양식</h1><p className="mt-3 leading-8 text-muted">주제와 기획은 매월 바꾸고, 운영에 필요한 문서는 매번 준비하도록 정한 구성입니다.<br/>현재는 양식의 기획을 확인하는 화면이며, 작성·저장 기능은 준비 중이에요.</p></header><div className="divide-y divide-border rounded-xl border border-border bg-surface">{templates.map(([title,body,cycle])=><section key={title} className="grid gap-3 p-6 sm:grid-cols-[190px_1fr]"><h2 className="text-lg font-bold">{title}</h2><div><p>{body}</p><p className="mt-2 text-sm text-muted">{cycle}</p></div></section>)}</div><p className="rounded-xl bg-tint p-6 leading-8 text-accent-deep">새 회차에는 양식의 구조와 공통 질문을 가져오고, 참석자·입금·출석·설문 응답은 새 기록으로 시작하도록 기획했어요.</p></div>;}
