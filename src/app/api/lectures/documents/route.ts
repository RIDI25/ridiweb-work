import { NextRequest } from "next/server";
import { uuidValue } from "@/lib/assistant/action-types";
import { documentInput } from "@/lib/lectures/types";
import { lectureAuth, lectureBody, lectureError, lectureReply as reply, savedVersion, staleLecture } from "@/lib/lectures/server";
export async function GET(req: NextRequest){
 const auth=await lectureAuth();if(!auth)return reply({error:"다시 로그인해 주세요."},401);
 try{
  const id=req.nextUrl.searchParams.get("id");
  if(id){
   uuidValue(id); const {data,error}=await auth.db.from("lecture_document_revisions").select("*").eq("document_id",id).order("version",{ascending:false}).limit(30);
   return error?reply({error:"이전 저장 내용을 불러오지 못했어요."},500):reply({revisions:data});
  }
  const {data,error,count}=await auth.db.from("lecture_documents").select("*",{count:"exact"}).is("project_id",null).eq("archived",false).order("updated_at",{ascending:false}).limit(500);
  return error?reply({error:"기본 자료를 불러오지 못했어요."},500):reply({documents:data,count});
 }catch(e){return lectureError(e);}
}
export async function POST(req:NextRequest){return write(req,false);}
export async function PATCH(req:NextRequest){return write(req,true);}
async function write(req:NextRequest,update:boolean){
 const auth=await lectureAuth();if(!auth)return reply({error:"다시 로그인해 주세요."},401);
 try{
  const input=await lectureBody(req), values=documentInput(input);
  if(update){
   const {title,body,status,archived}=values;
   const {data,error}=await auth.db.from("lecture_documents").update({title,body,status,archived}).eq("id",uuidValue(input.id)).eq("version",savedVersion(input.version)).select("*").maybeSingle();
   return error?reply({error:"문서를 저장하지 못했어요."},500):data?reply({document:data}):staleLecture();
  }
  const project_id=input.project_id?uuidValue(input.project_id):null;
  if(project_id){const p=await auth.db.from("lecture_projects").select("id").eq("id",project_id).eq("archived",false).maybeSingle();if(p.error||!p.data)return reply({error:"강의를 찾지 못했어요."},404);}
  if(input.source_id){
   const source=await auth.db.from("lecture_documents").select("body,kind").eq("id",uuidValue(input.source_id)).eq("archived",false).maybeSingle();
   if(source.error||!source.data)return reply({error:"복사할 자료를 찾지 못했어요."},404);
   values.body=source.data.body;values.kind=source.data.kind;values.status="draft";
  }
  const {data,error}=await auth.db.from("lecture_documents").insert({...values,project_id,owner_id:auth.user.id}).select("*").single();
  return error?reply({error:"문서를 저장하지 못했어요."},500):reply({document:data},201);
 }catch(e){return lectureError(e);}
}
