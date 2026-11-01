import type { SupabaseClient } from '@supabase/supabase-js';
export interface WorkspaceAccess{restricted:boolean;moaiRole:'reviewer'|'operator'|null}
export async function workspaceAccess(db:SupabaseClient,userId:string):Promise<WorkspaceAccess>{
 const [access,member]=await Promise.all([db.from('ridiweb_access').select('scope').eq('user_id',userId).maybeSingle(),db.from('moai_members').select('role').eq('user_id',userId).maybeSingle()]);
 if(access.error||member.error)throw new Error('업무 공간 권한을 확인하지 못했어요. 다시 로그인해 주세요.');
 return{restricted:access.data?.scope==='moai',moaiRole:member.data?.role||null};
}
export function allowedMoaiPath(path:string){return path==='/assistant'||path==='/schedule'||path==='/moai'||path.startsWith('/moai/')||path==='/api/moai'||path.startsWith('/api/moai/')||path==='/api/assistant'||path==='/api/assistant/conversations';}
