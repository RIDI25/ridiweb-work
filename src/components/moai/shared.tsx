'use client';
export {useUnsaved,Notice,DocumentPreview} from '@/components/lectures/shared';
export async function moaiApi(url:string,values?:unknown){const res=await fetch(url,{cache:'no-store',...(values?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)}:{})});if(!res.headers.get('content-type')?.includes('application/json'))throw new Error('다시 로그인한 뒤 시도해 주세요.');const data=await res.json();if(!res.ok)throw new Error(data.error||'연결을 확인하고 다시 시도해 주세요.');return data;}
export const ACTION_LABELS:Record<string,string>={created:'모임 생성',saved:'내용 저장',approval_reset:'내용 변경 · 재검토 필요',request:'검토 요청',approve:'승인',changes:'수정 요청',start:'운영 시작',complete:'결과 정리 완료',cancel:'취소',reopen:'다시 기획',participant:'명단·출석 기록',import:'명단 가져오기'};
