import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {eligibleCutoff,weekStart,writeVerified,transcriptOf} from './assistant-archive.mjs';
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
