import {requireProfile} from '@/lib/auth';import {MoaiDetail} from '@/components/moai/moai-detail';
export default async function Page({params}:{params:Promise<{id:string}>}){await requireProfile();const {id}=await params;return <MoaiDetail key={id} id={id}/>;}
