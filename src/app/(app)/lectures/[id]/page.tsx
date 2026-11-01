import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { uuidValue } from "@/lib/assistant/action-types";
import { LectureDetail } from "@/components/lectures/lecture-detail";
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{document?:string}>}){await requireProfile();const {id}=await params;try{uuidValue(id);}catch{notFound();}return <LectureDetail key={`${id}-${(await searchParams).document||""}`} id={id} documentId={(await searchParams).document}/>;}
