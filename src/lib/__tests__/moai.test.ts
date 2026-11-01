import {describe,it,expect} from 'vitest';
import {parseRoster,gatheringInput,participantInput,moaiCalendar,TEMPLATE_BODIES} from '../moai/types';
import {allowedMoaiPath,workspaceAccess} from '../workspace-access';
import type {SupabaseClient} from '@supabase/supabase-js';
const sid='10000000-0000-4000-8000-000000000001';
const base={title:'스터디',kind:'study',period:'2026-11',capacity:10,fee:10000,sessions:[{id:sid,title:'1회차',date:'2026-11-05',start:'10:00',end:'12:00',location:'모임 장소'}],checklist:[],...TEMPLATE_BODIES};
describe('MoAI form and calendar boundaries',()=>{
 it('accepts form columns and preserves phone text without inferring a payment or consent',()=>{
  expect(parseRoster('이름\t연락처\t입금자명\t메모\n김예시\t010-0012-3456\t다른 입금자\t첫 방문')).toEqual([{name:'김예시',contact:'010-0012-3456',payer:'다른 입금자',memo:'첫 방문'}]);
  expect(()=>parseRoster('이름\t전화\t입금자\t메모\t추가\n김예시\t1\t2\t3\t4')).toThrow();
 });
 it('rejects invalid dates, duplicate sessions and notes for removed sessions',()=>{
  expect(()=>gatheringInput({...base,sessions:[{...base.sessions[0],date:'2026-02-30'}]})).toThrow();
  expect(()=>gatheringInput({...base,sessions:[...base.sessions,...base.sessions]})).toThrow();
  expect(()=>gatheringInput({...base,session_notes:{unknown:'기록'}})).toThrow();
  expect(gatheringInput({...base,session_notes:{[sid]:'다음 회차 준비'}}).session_notes[sid]).toBe('다음 회차 준비');
 });
 it('keeps no-show distinct from absence and refuses invented attendance values',()=>{
  const p={name:'김예시',expected_fee:10000,paid_amount:0,status:'applied',attendance:{[sid]:'no_show'}};
  expect(participantInput(p)).toMatchObject({attendance:{[sid]:'no_show'},photo_consent:'pending',signature_checked:false});
  expect(()=>participantInput({...p,attendance:{[sid]:'yes'}})).toThrow();
 });
 it('shows draft dates as tentative and excludes archived or cancelled gatherings',()=>{
  const row={id:sid,title:'모임',state:'draft' as const,archived:false,sessions:base.sessions};
  const list=moaiCalendar([row,{...row,archived:true},{...row,state:'cancelled'},{...row,sessions:[{...row.sessions[0],date:''}]}]);
  expect(list).toHaveLength(1);expect(list[0]).toMatchObject({date:'2026-11-05',label:'[가안] 모임 · 1회차',href:`/moai/${sid}`});
 });
 it('allows only MoAI, private chat and calendar paths for operators',()=>{
  for(const p of ['/moai','/moai/templates','/api/moai/attendance','/assistant','/api/assistant/conversations','/api/assistant/actions','/schedule'])expect(allowedMoaiPath(p)).toBe(true);
  for(const p of ['/clients','/lectures','/settings','/api/assistant/actions/other','/api/moaix','/schedule-edit'])expect(allowedMoaiPath(p)).toBe(false);
 });
 it('never treats a failed access lookup as unrestricted',async()=>{
  const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:{message:'offline'}})})})})} as unknown as SupabaseClient;
  await expect(workspaceAccess(db,sid)).rejects.toThrow();
 });
});
