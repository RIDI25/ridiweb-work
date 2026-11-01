import { requireProfile } from "@/lib/auth";
import { LectureLibrary } from "@/components/lectures/lecture-library";
export default async function Page(){await requireProfile();return <LectureLibrary/>;}
