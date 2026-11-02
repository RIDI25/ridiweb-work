import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {eligibleCutoff,weekStart,writeVerified,transcriptOf,archiveAssistant,archiveAttachments} from './assistant-archive.mjs';
import {createHash,randomUUID} from 'node:crypto';
test('weekly cutoff is Monday 09:00 Korea with catch-up after sleep',()=>{
 assert.equal(eligibleCutoff(new Date('2026-11-01T23:59:59Z')),'2026-10-25T15:00:00.000Z');
 assert.equal(eligibleCutoff(new Date('2026-11-02T00:00:00Z')),'2026-11-01T15:00:00.000Z');
 assert.equal(eligibleCutoff(new Date('2026-11-04T10:00:00Z')),'2026-11-01T15:00:00.000Z');
 assert.equal(weekStart('2026-11-01T16:00:00Z'),'2026-11-02');
});
test('verified writes are idempotent, preserve edits and reject traversal/symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'optify-archive-'));
 try {
  const path='40_기록/옵티파이 비서/2026-10-19/원문.md';const body='원문은 그대로\n```\n보관';
  const first=await writeVerified(root,path,body);assert.equal(await writeVerified(root,path,body),first);
  await writeFile(join(root,path),'사용자가 고친 원문');await assert.rejects(()=>writeVerified(root,path,body));assert.equal(await readFile(join(root,path),'utf8'),'사용자가 고친 원문');
  await assert.rejects(()=>writeVerified(root,'../outside.md','x'));
  await mkdir(join(root,'outside'));await symlink(join(root,'outside'),join(root,'40_기록/옵티파이 비서/link'));
  await assert.rejects(()=>writeVerified(root,'40_기록/옵티파이 비서/link/원문.md','x'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('transcript preserves full content and tool/action metadata',()=>{
 const content='메시지\n```\n원문';const result=transcriptOf({id:'archive',week_start:'2026-10-19',week_end:'2026-10-26',snapshot:[{id:'message',conversation_id:'thread',title:'기획',role:'user',content,context:'전체 업무',created_at:'2026-10-20T00:00:00Z',metadata:{action_result:{status:'succeeded'}}}]});
 assert.ok(result.includes(content));assert.ok(result.includes('succeeded'));assert.ok(result.includes('````text'));
});
test('original attachments reach the vault before acknowledgement; failures retain the conversation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ridiweb-attachments-'));const bytes=Buffer.from('점검용 원본');
 const sha=value=>createHash('sha256').update(value).digest('hex');const id=randomUUID(),owner=randomUUID(),message=randomUUID(),conversation=randomUUID();
 const file={id,filename:'기획.txt',bytes:bytes.length,sha256:sha(bytes)};
 const archive={id:randomUUID(),user_id:owner,lease_token:randomUUID(),status:'prepared',week_start:'2026-10-19',week_end:'2026-10-26',summary:'요약',snapshot:[{id:message,conversation_id:conversation,title:'점검',role:'user',content:'읽어줘',created_at:'2026-10-20T00:00:00Z',metadata:{attachments:[file]}}]};
 archive.transcript_hash=sha(transcriptOf(archive));archive.summary_hash=sha(archive.summary);
 const row={...file,user_id:owner,conversation_id:conversation,message_id:message,status:'ready',storage_path:`${owner}/${id}/source.txt`};let acknowledged=0,failures=0;
 const path=archiveAttachments(archive)[0].path;
 const api=async(endpoint,method)=>{
  if(endpoint.startsWith('assistant_messages?'))return [{created_at:'2026-10-20T00:00:00Z'}];
  if(endpoint==='rpc/prepare_assistant_archive')return archive.id;
  if(endpoint==='rpc/claim_assistant_archive')return archive;
  if(endpoint.startsWith('assistant_attachments?'))return [row];
  if(endpoint==='rpc/acknowledge_assistant_archive'){assert.deepEqual(await readFile(join(root,path)),bytes);acknowledged++;return 1;}
  if(endpoint.startsWith('assistant_archives?')&&method==='PATCH')failures++;
  return null;
 };
 const options={api,config:{ownerId:owner,vaultPath:root},env:{},now:new Date('2026-11-02T01:00:00Z')};
 try{
  await assert.rejects(()=>archiveAssistant({...options,download:async()=>Buffer.from('wrong original')}));assert.equal(acknowledged,0);assert.equal(failures,1);
  const savedUser=row.user_id;row.user_id=randomUUID();let downloaded=false;
  await assert.rejects(()=>archiveAssistant({...options,download:async()=>{downloaded=true;return bytes;}}));assert.equal(downloaded,false);assert.equal(acknowledged,0);row.user_id=savedUser;
  await archiveAssistant({...options,download:async()=>bytes});assert.equal(acknowledged,1);assert.ok(transcriptOf(archive).includes(`[[${path}|기획.txt]]`));
 }finally{await rm(root,{recursive:true,force:true});}
});
