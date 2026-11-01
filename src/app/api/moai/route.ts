import { NextRequest } from 'next/server';
import { moaiAuth,moaiParticipants,reply,readBody,dbFailure } from '@/lib/moai/server';
import { gatheringInput,participantInput,parseRoster,TEMPLATE_BODIES,DOC_KINDS,CHECKS,type DocKind } from '@/lib/moai/types';
import { savedVersion,lectureError } from '@/lib/lectures/server';
import { uuidValue,textValue,enumValue } from '@/lib/assistant/action-types';
export async function GET(req:NextRequest){
 const auth=await moaiAuth();if(!auth)return reply({error:'모아이 계정으로 로그인해 주세요.'},403);
 const {db,role}=auth;const id=req.nextUrl.searchParams.get('id'),section=req.nextUrl.searchParams.get('section');
 try{
  if(section==='templates'){const {data,error}=await db.from('moai_templates').select('*');if(error)return dbFailure(error);return reply({role,templates:Object.entries(DOC_KINDS).map(([kind,title])=>data?.find(t=>t.kind===kind)||{kind,title,body:TEMPLATE_BODIES[kind as DocKind],version:0})});}
  if(id){uuidValue(id);
   const revision=req.nextUrl.searchParams.get('revision');if(revision){uuidValue(revision);const {data,error}=await db.from('moai_activity').select('snapshot,action,created_at,actor_name,comment').eq('gathering_id',id).eq('id',revision).maybeSingle();return error?dbFailure(error):data?reply(data):reply({error:'기록을 찾지 못했어요.'},404);}
   const [g,p,a]=await Promise.all([db.from('moai_gatherings').select('*').eq('id',id).maybeSingle(),moaiParticipants(db,id),db.from('moai_activity').select('id,action,comment,actor_name,created_at,version').eq('gathering_id',id).order('created_at',{ascending:false}).limit(50)]);
   if(g.error||p.error||a.error)return dbFailure((g.error||p.error||a.error)!);return g.data?reply({gathering:g.data,participants:p.data,activity:a.data,role,userId:auth.user.id}):reply({error:'모임을 찾지 못했어요.'},404);
  }
  const {data,error,count}=await db.from('moai_gatherings').select('id,title,kind,period,theme,capacity,fee,state,sessions,archived,version,updated_at',{count:'exact'}).eq('archived',req.nextUrl.searchParams.get('archived')==='true').order('updated_at',{ascending:false}).limit(500);
  return error?dbFailure(error):reply({gatherings:data,count,role});
 }catch(e){return lectureError(e);}
}
export async function POST(req:NextRequest){
 const auth=await moaiAuth();if(!auth)return reply({error:'모아이 계정으로 로그인해 주세요.'},403);
 try{
  const input=await readBody(req),action=String(input.action);const {db}=auth;
  if(action==='create'){
   const {data:templates,error}=await db.from('moai_templates').select('kind,body');if(error)return dbFailure(error);
   const source=input.copy_from?await db.from('moai_gatherings').select('timetable,survey,checklist').eq('id',uuidValue(input.copy_from)).single():null;if(source?.error)return dbFailure(source.error);
   const base={title:input.title,kind:enumValue(input.kind,['monthly','study']),period:input.period||'',theme:'',capacity:0,fee:0,sessions:[],checklist:CHECKS.map((title,i)=>({id:`check-${i}`,title,done:false})),...TEMPLATE_BODIES,...Object.fromEntries((templates||[]).map(t=>[t.kind,t.body])),...(source?.data?{timetable:source.data.timetable,survey:source.data.survey,checklist:source.data.checklist.map((c:{id:string;title:string})=>({...c,done:false}))}:{})};
   const {data,error:err}=await db.rpc('moai_save_gathering',{p_id:null,p_version:null,p_values:gatheringInput(base)});return err?dbFailure(err):reply({gathering:data},201);
  }
  if(action==='save'){const {data,error}=await db.rpc('moai_save_gathering',{p_id:uuidValue(input.id),p_version:savedVersion(input.version),p_values:gatheringInput(input)});return error?dbFailure(error):reply({gathering:data});}
  if(action==='transition'){const task=enumValue(input.transition,['request','approve','changes','start','complete','cancel','reopen']);if(['approve','changes'].includes(task)&&auth.role!=='reviewer')return reply({error:'최종 승인 담당자만 처리할 수 있어요.'},403);const {data,error}=await db.rpc('moai_transition',{p_id:uuidValue(input.id),p_version:savedVersion(input.version),p_action:task,p_comment:textValue(input.comment,'의견',false,2000)||''});return error?dbFailure(error):reply({gathering:data});}
  if(action==='participant'){const {data,error}=await db.rpc('moai_save_participant',{p_gathering:uuidValue(input.gathering_id),p_id:input.id?uuidValue(input.id):null,p_version:input.id?savedVersion(input.version):null,p_values:participantInput(input)});return error?dbFailure(error):reply({participant:data});}
  if(action==='import'){const rows=parseRoster(textValue(input.text,'명단',true,180000)!);if(!rows.length)return reply({error:'가져올 이름이 없어요.'},400);const {data,error}=await db.rpc('moai_import_participants',{p_gathering:uuidValue(input.gathering_id),p_rows:rows});return error?dbFailure(error):reply(data);}
  if(action==='template'){const version=input.version===0?0:savedVersion(input.version);const {data,error}=await db.rpc('moai_save_template',{p_kind:enumValue(input.kind,Object.keys(DOC_KINDS)),p_version:version,p_body:textValue(input.body,'양식',false,40000)||''});return error?dbFailure(error):reply({template:data});}
  return reply({error:'진행할 작업을 확인해 주세요.'},400);
 }catch(e){return lectureError(e);}
}
