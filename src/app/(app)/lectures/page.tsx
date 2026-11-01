import { requireProfile } from "@/lib/auth";
import { LectureList } from "@/components/lectures/lecture-list";
const kstToday = () => new Date(Date.now()+9*3600000).toISOString().slice(0,10);
export default async function Page(){await requireProfile();return <LectureList today={kstToday()}/>;}
