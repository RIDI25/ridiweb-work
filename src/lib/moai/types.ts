import { dateValue, enumValue, textValue, uuidValue } from '@/lib/assistant/action-types';
export const GATHERING_KINDS={monthly:'월 정기모임',study:'스터디'} as const;
export const MOAI_STATES={draft:'기획 중',review:'검토 요청',changes:'수정 요청',approved:'승인 완료',running:'운영 중',completed:'결과 정리 완료',cancelled:'취소'} as const;
export const DOC_KINDS={plan:'기획안',timetable:'타임테이블',record:'모임 기록지',survey:'참가자 설문지',result:'결과 정리',consent:'촬영 동의 안내'} as const;
export const REG_STATES={applied:'신청',confirmed:'참가 확정',waitlisted:'대기',cancelled:'취소'} as const;
export const ATTENDANCE={present:'출석',absent:'결석',no_show:'No-Show'} as const;
export type MoaiRole='reviewer'|'operator';
export type DocKind=keyof typeof DOC_KINDS;
export interface MoaiSession{id:string;title:string;date:string;start:string;end:string;location:string}
export interface MoaiCheck{id:string;title:string;done:boolean}
export interface Gathering{id:string;title:string;kind:keyof typeof GATHERING_KINDS;period:string;theme:string;capacity:number;fee:number;state:keyof typeof MOAI_STATES;sessions:MoaiSession[];checklist:MoaiCheck[];plan:string;timetable:string;record:string;survey:string;result:string;consent:string;session_notes:Record<string,string>;archived:boolean;version:number;approved_by:string|null;approved_version:number|null;reviewed_at:string|null;updated_at:string}
export const PARTICIPANT_ROLES={participant:'참여자',mentor:'멘토'} as const;
export const CONSENTS={pending:'미확인',agreed:'동의',declined:'미동의'} as const;
export interface Participant{id:string;gathering_id:string;name:string;contact:string;payer:string;role:keyof typeof PARTICIPANT_ROLES;photo_consent:keyof typeof CONSENTS;signature_checked:boolean;expected_fee:number;paid_amount:number;status:keyof typeof REG_STATES;memo:string;attendance:Record<string,keyof typeof ATTENDANCE>;version:number}
export interface MoaiTemplate{kind:DocKind;title:string;body:string;version:number}
export interface MoaiActivity{id:string;action:string;comment:string;actor_name:string;created_at:string;version:number|null;snapshot:Gathering|null}
export const CHECKS=['기획안·타임테이블 승인','신청 안내·명단 확인','입금·대기자 확인','장소·준비물 점검','출석부 준비','모임 기록지 작성','설문지 준비·안내','설문 결과·개선점 정리'];
export const TEMPLATE_BODIES:Record<DocKind,string>={
 consent:'모임 현장을 사진과 영상으로 기록합니다. 촬영물은 모임 기록과 MoAI DAY 콘텐츠(홈페이지·블로그·SNS·유튜브)에 활용될 수 있습니다.\n촬영을 원하지 않으면 운영진에게 알려 주세요. 동의하지 않아도 모임 참여에는 지장이 없습니다.\n원치 않는 촬영이나 게시가 확인되면 운영진에게 알려 주세요.\n직접 촬영할 때에도 다른 참여자의 의사를 확인하고 서로의 권리를 존중해 주세요.',
 plan:'## 이번 모임의 주제\n\n## 목적과 참여 대상\n\n## 진행 프로그램\n\n## 장소·정원·참가비\n\n## 준비물과 담당자\n\n## 검토가 필요한 사항\n',
 timetable:'| 시작 | 종료 | 프로그램 | 진행자 | 준비물 |\n| --- | --- | --- | --- | --- |\n| | | 도착·접수 | | |\n| | | 오프닝 | | |\n| | | 주요 프로그램 | | |\n| | | 나눔·마무리 | | |\n',
 record:'## 진행 일시·장소\n\n## 실제 진행 내용\n\n## 참여자 의견\n\n## 현장 이슈\n\n## 후속 할 일·담당자\n',
 survey:'## 공통 질문\n\n- 이번 모임의 전반적인 만족도는? (1~5점)\n- 가장 도움이 된 내용은?\n- 운영에서 개선할 점은?\n- 다음에 다루고 싶은 주제는?\n\n## 이번 주제의 질문\n\n## 설문 링크\n',
 result:'## 참석 현황\n\n## 설문 결과\n\n## 잘된 점\n\n## 개선할 점\n\n## 다음 회차에 반영할 일\n',
};
export const newSession=():MoaiSession=>({id:crypto.randomUUID(),title:'모임',date:'',start:'',end:'',location:''});
const str=(v:unknown,label:string,max=1000)=>textValue(v,label,false,max)||'';
const integer=(v:unknown,label:string,max:number)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw new Error(`${label}을 확인해 주세요.`);return v;};
export function gatheringInput(input:Record<string,unknown>){
 const period=str(input.period,'운영 월',7);if(period&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new Error('운영 월을 확인해 주세요.');
 const raw=input.sessions??[];if(!Array.isArray(raw)||raw.length>60)throw new Error('회차는 60개까지 저장할 수 있어요.');
 const sessions:MoaiSession[]=raw.map(s=>{if(!s||typeof s!=='object')throw new Error('회차 정보를 확인해 주세요.');const start=str(s.start,'시작 시간',5),end=str(s.end,'종료 시간',5);for(const t of [start,end])if(t&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw new Error('시간을 확인해 주세요.');if(!!start!==!!end||(start&&end<=start))throw new Error('시작·종료 시간을 함께 입력하고 종료를 시작 이후로 설정해 주세요.');return{id:uuidValue(s.id),title:textValue(s.title,'회차명',true,120)!,date:dateValue(s.date,'모임 날짜')||'',start,end,location:str(s.location,'장소',300)};});
 if(new Set(sessions.map(s=>s.id)).size!==sessions.length)throw new Error('중복된 회차가 있어요.');
 const rawChecks=input.checklist??[];if(!Array.isArray(rawChecks)||rawChecks.length>60)throw new Error('준비 항목을 확인해 주세요.');
 const checklist=rawChecks.map(c=>{if(!c||typeof c!=='object'||typeof c.done!=='boolean')throw new Error('준비 항목을 확인해 주세요.');return{id:str(c.id,'항목 번호',80),title:textValue(c.title,'준비 항목',true,250)!,done:c.done};});
 const notes=input.session_notes??{};if(!notes||typeof notes!=='object'||Array.isArray(notes))throw new Error('회차 메모를 확인해 주세요.');
 const session_notes:Record<string,string>={};for(const [id,note] of Object.entries(notes)){if(!sessions.some(s=>s.id===id))throw new Error('메모가 있는 회차를 먼저 확인해 주세요.');session_notes[id]=str(note,'회차 메모',6000);}
 return {session_notes,title:textValue(input.title,'모임명',true,200)!,kind:enumValue(input.kind,Object.keys(GATHERING_KINDS)),period,theme:str(input.theme,'주제',1000),capacity:integer(input.capacity,'정원',10000),fee:integer(input.fee,'참가비',10000000),sessions,checklist,...Object.fromEntries(Object.keys(DOC_KINDS).map(k=>[k,str(input[k],DOC_KINDS[k as DocKind],40000)])),archived:input.archived===true};
}
export function participantInput(input:Record<string,unknown>){
 const attendance=input.attendance??{};if(!attendance||typeof attendance!=='object'||Array.isArray(attendance)||Object.keys(attendance).length>60)throw new Error('출석 기록을 확인해 주세요.');
 const clean:Participant['attendance']={};for(const [id,status] of Object.entries(attendance)){clean[uuidValue(id)]=enumValue(status,Object.keys(ATTENDANCE)) as keyof typeof ATTENDANCE;}
 return{role:enumValue(input.role,Object.keys(PARTICIPANT_ROLES),'participant'),photo_consent:enumValue(input.photo_consent,Object.keys(CONSENTS),'pending'),signature_checked:input.signature_checked===true,name:textValue(input.name,'이름',true,120)!,contact:str(input.contact,'연락처',200),payer:str(input.payer,'입금자명',120),expected_fee:integer(input.expected_fee,'참가비',10000000),paid_amount:integer(input.paid_amount,'확인한 입금액',10000000),status:enumValue(input.status,Object.keys(REG_STATES)),memo:str(input.memo,'메모',2000),attendance:clean};
}
/** Paste four spreadsheet columns. No payment/attendance is inferred from form answers. */
export function parseRoster(text:string){
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(l=>l.trim());if(lines.length>501)throw new Error('한 번에 500명까지 가져올 수 있어요.');
 if(lines[0]&&/^(이름|성함|성명|name)\s*(\t|$)/i.test(lines[0]))lines.shift();
 return lines.map((line,i)=>{const cols=line.split('\t');if(cols.length>4)throw new Error(`${i+1}행: 이름·연락처·입금자명·메모 네 열만 복사해 주세요.`);const [name='',contact='',payer='',memo='']=cols.map(s=>s.trim());if(!name||name.length>120||contact.length>200||payer.length>120||memo.length>2000)throw new Error(`${i+1}행의 이름 또는 글자 수를 확인해 주세요.`);return{name,contact,payer,memo};});
}
export function moaiCalendar(rows:Pick<Gathering,'id'|'title'|'state'|'archived'|'sessions'>[]){return rows.filter(r=>!r.archived&&r.state!=='cancelled').flatMap(r=>r.sessions.filter(s=>s.date).map(s=>({key:`moai-${r.id}-${s.id}`,date:s.date,time:s.start||null,label:`${['draft','review','changes'].includes(r.state)?'[가안] ':''}${r.title} · ${s.title}`,sub:['모아이',s.end&&`~${s.end}`,s.location].filter(Boolean).join(' · '),href:`/moai/${r.id}`})));}
