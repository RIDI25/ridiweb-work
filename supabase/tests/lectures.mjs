import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';let passed=0;
const login=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};
const test=async(n,f)=>{await f();console.log('PASS',n);passed++;};
try{
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;create table profiles(id uuid primary key);create function public.is_team_member() returns boolean language sql security definer as $$select exists(select 1 from profiles where id=auth.uid())$$;`);
 await db.query('insert into profiles values($1),($2)',[a,b]);
 const sql=await readFile(new URL('../migrations/0036_lectures.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);await login(a);
 const pid=(await db.query("insert into lecture_projects(owner_id,title,origin,stage) values($1,'제안 중','proposal','drafting') returning id",[a])).rows[0].id;
 const did=(await db.query("insert into lecture_documents(owner_id,project_id,kind,title,body) values($1,$2,'proposal','제안서','초안 1') returning id",[a,pid])).rows[0].id;
 await test('records and revision snapshots are private between owners',async()=>{assert.equal((await db.query('select * from lecture_document_revisions')).rows.length,1);await login(b);for(const t of ['lecture_projects','lecture_documents','lecture_document_revisions'])assert.equal((await db.query(`select * from ${t}`)).rows.length,0);});
 await test('cannot write another account records or cross-link project',async()=>{assert.equal((await db.query("update lecture_projects set title='forged' where id=$1 returning id",[pid])).rows.length,0);await assert.rejects(()=>db.query("insert into lecture_projects(owner_id,title,origin,stage) values($1,'x','proposal','drafting')",[a]));await assert.rejects(()=>db.query("insert into lecture_documents(owner_id,project_id,kind,title) values($1,$2,'proposal','x')",[b,pid]));});
 await login(a);
 await test('optimistic locking rejects stale overwrites',async()=>{await db.query("update lecture_documents set body='초안 2' where id=$1 and version=1",[did]);assert.equal((await db.query("update lecture_documents set body='stale' where id=$1 and version=1 returning id",[did])).rows.length,0);await assert.rejects(()=>db.query('update lecture_documents set version=1 where id=$1',[did]));});
 await test('final versions remain readable when edited draft changes',async()=>{await db.query("update lecture_documents set status='final' where id=$1",[did]);await db.query("update lecture_documents set body='새 초안',status='final' where id=$1",[did]);assert.equal((await db.query('select status from lecture_documents where id=$1',[did])).rows[0].status,'draft');assert.equal((await db.query("select body from lecture_document_revisions where document_id=$1 and status='final'",[did])).rows[0].body,'초안 2');});
 await test('browser cannot forge snapshots, move ownership or delete originals',async()=>{await assert.rejects(()=>db.query('update lecture_projects set owner_id=$1 where id=$2',[b,pid]));await assert.rejects(()=>db.query("update lecture_document_revisions set body='fake'"));await assert.rejects(()=>db.query('delete from lecture_documents'));await assert.rejects(()=>db.query('update lecture_documents set project_id=null'));});
 await test('career history requires completed lecture; archives restore',async()=>{await assert.rejects(()=>db.query('update lecture_projects set history_verified=true where id=$1',[pid]));await db.query("update lecture_projects set stage='completed',history_verified=true,archived=true where id=$1",[pid]);await db.query('update lecture_projects set archived=false where id=$1',[pid]);assert.equal((await db.query('select history_verified from lecture_projects where id=$1',[pid])).rows[0].history_verified,true);});
 await test('anonymous access is denied',async()=>{await login('','anon');await assert.rejects(()=>db.query('select * from lecture_projects'));});
 console.log(JSON.stringify({passed,migration:'0036',rerun:true}));
}finally{await db.close();}
