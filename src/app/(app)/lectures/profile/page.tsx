import { requireProfile } from "@/lib/auth";
import { LectureLibrary } from "@/components/lectures/lecture-library";
export default async function Page({searchParams}:{searchParams:Promise<{document?:string}>}){await requireProfile();const {document}=await searchParams;return <LectureLibrary profile key={document||"default"} documentId={document}/>;}
