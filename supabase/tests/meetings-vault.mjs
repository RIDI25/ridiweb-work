import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const a='10000000-0000-4000-8000-000000000001', b='10000000-0000-4000-8000-000000000002', stranger='10000000-0000-4000-8000-000000000003';
let passed=0;
async function check(name, fn) { await fn(); passed++; console.log('PASS',name); }
const login=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};
const admin=()=>login('','postgres');
try {
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to authenticated,anon,service_role;create table profiles(id uuid primary key);create table clients(id uuid primary key);create function public.is_team_member() returns boolean language sql security definer as $$select exists(select 1 from profiles where id=auth.uid())$$;`);
 await db.query('insert into profiles values($1),($2)',[a,b]);
 const migration=await readFile(new URL('../migrations/0034_meetings_vault.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
 const snapshot=[{path:'기획/비서봇.md',title:'비서봇 기획',body:'현재 결정: 옵티파이에서 진행. 비밀 자료.',content_hash:'hash1',source_modified_at:'2026-11-01T00:00:00Z'}];
 await login('','service_role'); await db.query('select sync_vault_notes($1,$2,$3,0)',[a,'Vault',JSON.stringify(snapshot)]);
 await check('private index and sync state stay private between team accounts',async()=>{
  await login(b);assert.equal((await db.query('select * from vault_notes')).rows.length,0);assert.equal((await db.query('select * from vault_sync_state')).rows.length,0);assert.equal((await db.query("select * from search_workspace_notes('비서봇','all',8)")).rows.length,0);
  await login(a);assert.equal((await db.query("select * from search_workspace_notes('비서봇 현재','vault',8)")).rows.length,1);
 });
 await check('browser cannot modify private index or call bridge RPC',async()=>{
  await assert.rejects(()=>db.query('delete from vault_notes'));await assert.rejects(()=>db.query("update vault_sync_state set error='forged'"));await assert.rejects(()=>db.query('select sync_vault_notes($1,$2,$3,0)',[a,'Vault','[]']));
 });
 let id;
 await check('meetings are shared but author cannot be forged',async()=>{
  await assert.rejects(()=>db.query("insert into meeting_notes(title,meeting_date,created_by) values('forged','2026-11-01',$1)",[b]));
  id=(await db.query("insert into meeting_notes(title,meeting_date,created_by,body) values('고객 회의','2026-11-01',$1,'결정 사항') returning id",[a])).rows[0].id;
  await login(b);assert.equal((await db.query('select * from meeting_notes')).rows.length,1);
 });
 await check('stale save cannot overwrite edits or forge a version',async()=>{
  await db.query("update meeting_notes set body='새 결정' where id=$1 and version=1",[id]);
  await login(a);assert.equal((await db.query("update meeting_notes set body='오래된 내용' where id=$1 and version=1 returning id",[id])).rows.length,0);
  assert.equal((await db.query('select body from meeting_notes where id=$1',[id])).rows[0].body,'새 결정');
  await assert.rejects(()=>db.query('update meeting_notes set version=1 where id=$1',[id]));await assert.rejects(()=>db.query('delete from meeting_notes where id=$1',[id]));
 });
 await check('archive hides meetings from assistant and restore brings them back',async()=>{
  await db.query('update meeting_notes set archived=true where id=$1',[id]);assert.equal((await db.query("select * from search_workspace_notes('고객','meeting',8)")).rows.length,0);
  await db.query('update meeting_notes set archived=false where id=$1',[id]);assert.equal((await db.query("select * from search_workspace_notes('고객','meeting',8)")).rows.length,1);
 });
 await check('non-team and anonymous access fail closed',async()=>{
  await login(stranger);assert.equal((await db.query('select * from meeting_notes')).rows.length,0);assert.equal((await db.query("select * from search_workspace_notes('','all',30)")).rows.length,0);
  await login('','anon');await assert.rejects(()=>db.query('select * from vault_notes'));await assert.rejects(()=>db.query("select * from search_workspace_notes('','all',8)"));
 });
 await check('invalid snapshot preserves index; valid deletion prunes atomically',async()=>{
  await login('','service_role');await assert.rejects(()=>db.query('select sync_vault_notes($1,$2,$3,0)',[a,'Vault',JSON.stringify([{...snapshot[0],body:null}])]));
  await admin();assert.equal((await db.query('select * from vault_notes')).rows.length,1);
  await login('','service_role');await db.query('select sync_vault_notes($1,$2,$3,0)',[a,'Vault','[]']);await admin();assert.equal((await db.query('select * from vault_notes')).rows.length,0);assert.equal((await db.query('select note_count from vault_sync_state')).rows[0].note_count,0);
 });
 console.log(JSON.stringify({passed,migration:'0034',rerun:true}));
} finally {await db.close();}
