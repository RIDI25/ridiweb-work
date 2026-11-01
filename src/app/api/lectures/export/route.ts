import { NextRequest, NextResponse } from "next/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { uuidValue } from "@/lib/assistant/action-types";
import { lectureAuth, lectureError, lectureReply as reply } from "@/lib/lectures/server";
export async function GET(req:NextRequest){
 const auth=await lectureAuth();if(!auth)return reply({error:"다시 로그인해 주세요."},401);
 try{
  const id=uuidValue(req.nextUrl.searchParams.get("id"));
  const {data,error}=await auth.db.from("lecture_documents").select("title,body,status,version").eq("id",id).maybeSingle();
  if(error||!data)return reply({error:"문서를 찾을 수 없어요."},404);
  const format=req.nextUrl.searchParams.get("format")==="md"?"md":"docx";
  const filename=encodeURIComponent(`${data.title.replace(/[\r\n/\\]/g,"_")}_v${data.version}.${format}`);
  const headers={"Cache-Control":"no-store","Content-Disposition":`attachment; filename="lecture.${format}"; filename*=UTF-8''${filename}`,"Content-Type":format==="md"?"text/markdown; charset=utf-8":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
  if(format==="md")return new NextResponse(`# ${data.title}\n\n${data.body}`,{headers});
  const paragraphs=data.body.split("\n").map((line:string)=>{const h=line.match(/^(#{1,3})\s+(.+)$/);return new Paragraph({heading:h?(h[1].length===1?HeadingLevel.HEADING_1:h[1].length===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3):undefined,children:[new TextRun({text:h?h[2]:line})],spacing:{after:120}});});
  const file=new Document({styles:{default:{document:{run:{font:"맑은 고딕",size:22},paragraph:{spacing:{line:320}}}}},sections:[{children:[new Paragraph({text:data.title,heading:HeadingLevel.TITLE}),...paragraphs]}]});
  return new NextResponse(new Uint8Array(await Packer.toBuffer(file)),{headers});
 }catch(e){return lectureError(e);}
}
