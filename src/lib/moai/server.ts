import type {SupabaseClient} from '@supabase/supabase-js';
import type {Participant} from './types';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { lectureReply,lectureBody } from '@/lib/lectures/server';
export const reply=lectureReply;
export const body=lectureBody;
export async function moaiAuth(){const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return null;const {data,error}=await db.from('moai_members').select('role').eq('user_id',user.id).maybeSingle();return error||!data?null:{db,user,role:data.role as 'reviewer'|'operator'};}
export const dbFailure=(error:{message:string;details?:string})=>reply({error:error.details==='stale'?'다른 창에서 변경됐어요. 입력 내용을 복사해 둔 뒤 최신 내용을 다시 열어 주세요.':/^[가-힣]/.test(error.message)?error.message:'저장하지 못했어요. 입력 내용과 연결을 확인해 주세요.'},error.details==='stale'?409:400);
export async function readBody(req:NextRequest){return body(req);}

// PostgREST caps each response at 1,000 rows; a gathering allows 2,000.
export async function moaiParticipants(db:SupabaseClient,gatheringId:string,confirmed=false){
 const rows:Participant[]=[];
 for(let from=0;from<2000;from+=1000){
  let query=db.from('moai_participants').select('*').eq('gathering_id',gatheringId).order('created_at').order('id').range(from,from+999);
  if(confirmed)query=query.eq('status','confirmed');
  const {data,error}=await query;if(error)return {data:null,error};rows.push(...data);if(data.length<1000)break;
 }
 return {data:rows,error:null};
}
