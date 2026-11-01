import Link from "next/link";
import { requireProfile } from "@/lib/auth";
export default async function MoaiPage(){
 await requireProfile();
 return <div className="mx-auto max-w-5xl space-y-8"><header><p className="text-sm font-semibold tracking-wider text-accent-deep">RIDIWEB · MOAI</p><div className="mt-3 flex flex-wrap items-center gap-4"><h1 className="text-2xl font-bold tracking-tight">모아이 모임</h1><span className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-muted">운영 기능 준비 중</span></div><p className="mt-3 text-muted">정기모임과 스터디를 준비하는 공간입니다. 지금까지 정한 운영 방향부터 모아두었어요.</p></header>
 <div className="grid gap-5 sm:grid-cols-2"><section className="rounded-xl border border-border bg-surface p-7"><p className="text-sm font-medium text-accent-deep">매월 새로운 주제</p><h2 className="mt-3 text-xl font-bold">월 정기모임</h2><p className="mt-4 leading-8 text-muted">주제와 프로그램은 매월 새로 기획하고, 타임테이블·명단·출석부·기록지·설문지를 빠짐없이 준비하는 구조로 기획했어요.</p></section><section className="rounded-xl border border-border bg-surface p-7"><p className="text-sm font-medium text-accent-deep">월 등록 · 회차별 출석</p><h2 className="mt-3 text-xl font-bold">스터디</h2><p className="mt-4 leading-8 text-muted">월별 스터디 명단과 입금 상태를 관리하고, 실제 참여 기록은 각 회차의 출석부에 연결하도록 기획했어요.</p></section></div>
 <section className="rounded-xl border border-border bg-surface p-7"><h2 className="text-xl font-bold">함께 준비하고, 확인 후 진행</h2><p className="mt-4 leading-8">기획안·타임테이블 작성 → 검토 요청 → 승인 또는 수정 요청 → 모임 운영 → 결과 기록</p><p className="mt-3 text-muted">신청자 명단·출석·승인·입금 매칭은 기획 단계입니다. 실제 신청 자료를 연결하거나 운영 기록을 등록하는 기능은 아직 적용하지 않았어요.</p></section>
 <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6"><div><h2 className="font-semibold">매번 챙길 기본 양식</h2><p className="mt-1 text-muted">주제는 달라져도 준비와 기록은 이어갈 수 있도록.</p></div><Link href="/moai/templates" className="rounded-lg bg-accent px-5 py-3 font-semibold text-white">운영 양식 구성 보기 →</Link></div>
 </div>;
}
