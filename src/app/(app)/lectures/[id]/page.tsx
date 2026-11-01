import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { uuidValue } from "@/lib/assistant/action-types";
import { LectureDetail } from "@/components/lectures/lecture-detail";
export default async function Page({params}:{params:Promise<{id:string}>}){await requireProfile();const {id}=await params;try{uuidValue(id);}catch{notFound();}return <LectureDetail id={id}/>;}
