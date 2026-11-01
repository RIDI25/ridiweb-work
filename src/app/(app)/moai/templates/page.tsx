import {requireProfile} from '@/lib/auth';import {MoaiTemplates} from '@/components/moai/moai-templates';
export default async function Page(){await requireProfile();return <MoaiTemplates/>;}
