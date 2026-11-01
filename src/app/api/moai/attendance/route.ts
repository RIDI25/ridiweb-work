import type {Gathering,Participant} from '@/lib/moai/types';
import {NextRequest,NextResponse} from 'next/server';import {moaiAuth,moaiParticipants,reply,dbFailure} from '@/lib/moai/server';import {uuidValue,enumValue} from '@/lib/assistant/action-types';import {lectureError} from '@/lib/lectures/server';import {buildMoaiAttendance} from '@/lib/export/moai-attendance-pdf';
export const runtime='nodejs';export const maxDuration=60;
export async function GET(req:NextRequest){const auth=await moaiAuth();if(!auth)return reply({error:'모아이 계정으로 로그인해 주세요.'},403);try{const layout=enumValue(req.nextUrl.searchParams.get('layout'),['month','daily','event'],'month') as 'month'|'daily'|'event',id=req.nextUrl.searchParams.get('id');let gathering:Gathering|undefined;let participants:Participant[]=[];
 if(id){uuidValue(id);const [g,p]=await Promise.all([auth.db.from('moai_gatherings').select('*').eq('id',id).maybeSingle(),moaiParticipants(auth.db,id,true)]);if(g.error||p.error)return dbFailure((g.error||p.error)!);if(!g.data)return reply({error:'모임을 찾지 못했어요.'},404);gathering=g.data;participants=p.data||[];}
 const buffer=await buildMoaiAttendance({layout,gathering,participants,sessionId:req.nextUrl.searchParams.get('session')||undefined,filled:req.nextUrl.searchParams.get('filled')==='true'});
 return new NextResponse(new Uint8Array(buffer),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="MoAI-${layout}-attendance.pdf"`,'Cache-Control':'no-store'}});
 }catch(e){return lectureError(e);}}
