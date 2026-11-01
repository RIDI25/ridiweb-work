import { NextRequest } from "next/server";
import { uuidValue } from "@/lib/assistant/action-types";
import { projectInput } from "@/lib/lectures/types";
import { lectureAuth, lectureBody, lectureError, lectureReply as reply, savedVersion, staleLecture } from "@/lib/lectures/server";
export async function GET(req: NextRequest) {
 const auth=await lectureAuth(); if(!auth) return reply({error:"다시 로그인해 주세요."},401);
 try {
  const id=req.nextUrl.searchParams.get("id");
  if(id) {
   uuidValue(id);
   const [p,d]=await Promise.all([auth.db.from("lecture_projects").select("*").eq("id",id).maybeSingle(),auth.db.from("lecture_documents").select("*").eq("project_id",id).eq("archived",false).order("updated_at",{ascending:false}).limit(200)]);
   if(p.error||d.error) return reply({error:"강의 내용을 불러오지 못했어요."},500);
   return p.data?reply({project:p.data,documents:d.data}):reply({error:"강의를 찾을 수 없어요."},404);
  }
  let query=auth.db.from("lecture_projects").select("*",{count:"exact"});
  query=req.nextUrl.searchParams.get("history")==="true"?query.eq("history_verified",true):query.eq("archived",req.nextUrl.searchParams.get("archived")==="true");
  const {data,error,count}=await query.order("updated_at",{ascending:false}).limit(500);
  return error?reply({error:"강의 목록을 불러오지 못했어요."},500):reply({projects:data,count});
 } catch(e){return lectureError(e);}
}
export async function POST(req: NextRequest){return write(req,false);}
export async function PATCH(req: NextRequest){return write(req,true);}
async function write(req:NextRequest, update:boolean){
 const auth=await lectureAuth(); if(!auth)return reply({error:"다시 로그인해 주세요."},401);
 try{
  const input=await lectureBody(req), values=projectInput(input);
  if(update){
   const {data,error}=await auth.db.from("lecture_projects").update(values).eq("id",uuidValue(input.id)).eq("version",savedVersion(input.version)).select("*").maybeSingle();
   return error?reply({error:"저장하지 못했어요. 입력 내용과 연결을 확인해 주세요."},500):data?reply({project:data}):staleLecture();
  }
  const {data,error}=await auth.db.from("lecture_projects").insert({...values,owner_id:auth.user.id}).select("*").single();
  return error?reply({error:"강의를 저장하지 못했어요."},500):reply({project:data},201);
 }catch(e){return lectureError(e);}
}
