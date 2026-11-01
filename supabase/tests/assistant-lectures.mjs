// Run with PGLITE_MODULE pointing at an installed @electric-sql/pglite module.
// All data is synthetic and ephemeral; this script never connects to Supabase.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../migrations/', import.meta.url);
const sql = name => readFileSync(new URL(name,root),'utf8');
const owner=randomUUID(), other=randomUUID(), member=randomUUID(), outsider=randomUUID(), client=randomUUID();
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
 await db.exec(sql('0001_schema.sql').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`create function public.is_team_member() returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid()) $$;
 create function public.get_my_role() returns text language sql security definer set search_path=public as $$ select role from profiles where id=auth.uid() $$;
 create table quotes(id uuid primary key); create table client_services(id uuid primary key);`);
 for(const name of ['0014_leads_sales.sql','0016_deal_channels.sql','0017_tax_invoices.sql','0018_invoice_payments.sql','0021_tasks.sql','0022_events.sql','0024_ledger.sql']) await db.exec(sql(name));
 await db.exec('grant all on all tables in schema public to authenticated, service_role;');
 for(const name of ['0033_assistant_confirmation_waiting.sql','0035_assistant_history_archives.sql','0036_lectures.sql','0037_moai.sql','0038_workspace_access.sql','0040_assistant_moai_actions.sql','0041_assistant_lecture_actions.sql']) await db.exec(sql(name));
 await db.exec(sql('0041_assistant_lecture_actions.sql'));
 for(const [id,name,role] of [[owner,'Owner','owner'],[other,'Other','owner'],[member,'Member','member']]) {
  await db.query('insert into auth.users(id) values($1)',[id]); await db.query('insert into profiles(id,name,role) values($1,$2,$3)',[id,name,role]);
 }
 await db.query('insert into clients(id,name) values($1,$2)',[client,'Fixture customer']);
 const login=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`set role ${role}`);};
 const admin=()=>login('', 'postgres');
 const draft=async(tool,payload,user=owner,expires=null)=>{await admin(); const id=randomUUID();await db.query(`insert into assistant_action_requests(id,user_id,tool_name,payload,display,expires_at) values($1,$2,$3,$4,$5,coalesce($6::timestamptz,now()+interval '24 hours'))`,[id,user,tool,JSON.stringify(payload),JSON.stringify({title:tool,fields:[]}),expires]);return id;};
 const resolve=async(id,decision='confirm',user=owner)=>{await login(user);return (await db.query('select resolve_chat_assistant_action($1,$2) as action',[id,decision])).rows[0].action;};
 const row=async(table,id)=>{await admin();return (await db.query(`select to_jsonb(t) as r from ${table} t where id=$1`,[id])).rows[0]?.r;};
 const count=async(table,where='',params=[])=>{await admin();return Number((await db.query(`select count(*) as n from ${table} ${where}`,params)).rows[0].n);};
 await admin();
 await db.query("insert into moai_members values($1,'reviewer'),($2,'operator')",[owner,member]);
 await db.query("insert into ridiweb_access values($1,'full',null),($2,'moai',$1)",[owner,member]);
 const sessions=[{id:randomUUID(),title:'강의',date:'2026-11-12',start:'10:00',end:'12:00',location:'서울',confirmed:false,kind:'lecture'}];
 const values={title:'Fixture lecture',origin:'inquiry',stage:'expected',organization:'Institute',contact:'',audience:'',brief:'기존 메모',fee:'',next_action:'검토',next_action_date:'2026-11-10',sessions,checklist:[{id:'check-1',title:'자료 준비',done:false}],history_verified:false,archived:false};
 const docValues={title:'제안서',kind:'proposal',body:'전체 제안 내용',status:'draft',archived:false};
 let projectId,docId,createId;
 await check('confirm atomically creates own project, schedules, documents and revision; replay cannot duplicate',async()=>{
  createId=await draft('create_lecture_project',{values,documents:[docValues]});
  assert.equal(await count('lecture_projects'),0);const result=await resolve(createId);assert.equal(result.status,'succeeded');projectId=result.result.record_id;
  const project=await row('lecture_projects',projectId);assert.equal(project.owner_id,owner);assert.deepEqual(project.sessions,sessions);
  await admin();docId=(await db.query('select id from lecture_documents where project_id=$1',[projectId])).rows[0].id;
  assert.equal(await count('lecture_document_revisions'),1);assert.equal((await row('lecture_documents',docId)).owner_id,owner);
  await resolve(createId);assert.equal(await count('lecture_projects'),1);assert.equal(await count('lecture_documents'),1);assert.equal(await count('events'),0);
 });
 await check('same-name drafts fail without duplicate projects; cancel/expiry produce no business writes',async()=>{
  assert.equal((await resolve(await draft('create_lecture_project',{values,documents:[]}))).status,'failed');
  const cancel=await draft('create_lecture_project',{values:{...values,title:'Cancelled'},documents:[]});assert.equal((await resolve(cancel,'cancel')).status,'cancelled');assert.equal((await resolve(cancel)).status,'cancelled');
  const expired=await draft('create_lecture_project',{values:{...values,title:'Expired'},documents:[]},owner,'2020-01-01');assert.equal((await resolve(expired)).status,'expired');assert.equal(await count('lecture_projects'),1);
 });
 await check('project edits retain documents and appear as sessions, with stale writes rejected',async()=>{
  const changed={...values,sessions:[{...sessions[0],start:'11:00',end:'13:00'}, {...sessions[0],id:randomUUID(),title:'이동',kind:'travel',start:'09:00',end:'10:00'}],checklist:[{...values.checklist[0],done:true}]};
  const stale=await draft('update_lecture_project',{project_id:projectId,expected_version:1,values:{...values,title:'stale'}});
  const good=await draft('update_lecture_project',{project_id:projectId,expected_version:1,values:changed});assert.equal((await resolve(good)).status,'succeeded');assert.equal((await row('lecture_projects',projectId)).version,2);
  assert.equal((await resolve(stale)).status,'failed');assert.equal((await row('lecture_projects',projectId)).title,values.title);assert.equal(await count('lecture_documents'),1);assert.equal(await count('events'),0);
 });
 await check('security-definer enforces ownership on updates and document attachment even for another owner',async()=>{
  for(const [tool,payload] of [['update_lecture_project',{project_id:projectId,expected_version:2,values}],['save_lecture_document',{document_id:docId,project_id:projectId,expected_version:1,values:{...docValues,body:'foreign'}}],['save_lecture_document',{project_id:projectId,values:{...docValues,title:'foreign'}}]])assert.equal((await resolve(await draft(tool,payload,other),'confirm',other)).status,'failed');
  await login(other);for(const table of ['lecture_projects','lecture_documents','lecture_document_revisions'])assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
  assert.equal((await row('lecture_documents',docId)).body,docValues.body);
 });
 await check('MoAI-only users cannot read lecture records or execute forged lecture drafts',async()=>{
  for(const tool of ['create_lecture_project','update_lecture_project','save_lecture_document']) {
    const id=await draft(tool,{values,documents:[]},member);await login(member);assert.equal((await db.query('select id from assistant_action_requests where id=$1',[id])).rows.length,0);await assert.rejects(()=>resolve(id,'confirm',member),/변경 권한/);
  }
  await login(member);assert.equal((await db.query('select * from lecture_projects')).rows.length,0);
 });
 await check('invalid schedule and invalid child document roll back all records/revisions',async()=>{
  const n=await count('lecture_projects'),rev=await count('lecture_document_revisions');
  for(const patch of [{sessions:[{...sessions[0],end:'09:00'}]},{sessions:[{...sessions[0],date:'2026-02-30'}]},{sessions:[{...sessions[0],confirmed:'yes'}]},{checklist:[{id:'c',title:'',done:false}]}])assert.equal((await resolve(await draft('create_lecture_project',{values:{...values,title:randomUUID(),...patch},documents:[]}))).status,'failed');
  assert.equal((await resolve(await draft('create_lecture_project',{values:{...values,title:'Invalid child'},documents:[docValues,{...docValues,kind:'invalid'}]}))).status,'failed');
  assert.equal(await count('lecture_projects'),n);assert.equal(await count('lecture_document_revisions'),rev);
 });
 await check('document edits, separate final confirmation, stale guard and restoration preserve history',async()=>{
  const update=async(version,patch)=>resolve(await draft('save_lecture_document',{document_id:docId,project_id:projectId,expected_version:version,values:{...docValues,...patch}}));
  assert.equal((await update(1,{body:'수정 내용',status:'final'})).status,'failed');assert.equal((await row('lecture_documents',docId)).version,1);
  assert.equal((await update(1,{body:'수정 내용'})).status,'succeeded');assert.equal((await update(1,{body:'오래된 변경'})).status,'failed');
  assert.equal((await update(2,{body:'수정 내용',status:'final'})).status,'succeeded');assert.equal((await row('lecture_documents',docId)).status,'final');
  assert.equal((await update(3,{body:docValues.body})).status,'succeeded');const doc=await row('lecture_documents',docId);assert.equal(doc.status,'draft');assert.equal(doc.version,4);assert.equal(await count('lecture_document_revisions','where document_id=$1',[docId]),4);
 });
 await check('library documents support own profile creation, archive/restore, replay and download links',async()=>{
  const library={...docValues,kind:'profile',title:'강사 소개'};const id=await draft('save_lecture_document',{project_id:null,values:library});const result=await resolve(id);assert.equal(result.status,'succeeded');assert.equal(result.result.href,`/lectures/profile?document=${id}`);assert.equal(result.result.document_id,id);
  await resolve(id);assert.equal(await count('lecture_document_revisions','where document_id=$1',[id]),1);
  const archived=await resolve(await draft('save_lecture_document',{document_id:id,project_id:null,expected_version:1,values:{...library,archived:true}}));assert.equal(archived.status,'succeeded');assert.equal(archived.result.document_id,undefined);
  const restored=await resolve(await draft('save_lecture_document',{document_id:id,project_id:null,expected_version:2,values:library}));assert.equal(restored.status,'succeeded');assert.equal((await row('lecture_documents',id)).body,library.body);
 });
 await check('career verification requires completion; archive and restore remain versioned',async()=>{
  let p=await row('lecture_projects',projectId);
  assert.equal((await resolve(await draft('update_lecture_project',{project_id:projectId,expected_version:p.version,values:{...p,history_verified:true}}))).status,'failed');
  for(const patch of [{stage:'completed',history_verified:true},{archived:true},{archived:false}]){p=await row('lecture_projects',projectId);assert.equal((await resolve(await draft('update_lecture_project',{project_id:projectId,expected_version:p.version,values:{...p,...patch}}))).status,'succeeded');}
  assert.equal((await row('lecture_projects',projectId)).history_verified,true);
 });
 await check('MoAI and Optify existing confirmation branches remain usable',async()=>{
  const event=await draft('create_event',{title:'Fixture event',event_date:'2026-11-05',event_type:'meeting'});assert.equal((await resolve(event)).status,'succeeded');
  const moai=await draft('create_moai_gathering',{values:{title:'Fixture study',kind:'study',period:'2026-11',theme:'',capacity:0,fee:0,sessions:[],checklist:[],plan:'',timetable:'',survey:'',record:'',result:'',consent:'',session_notes:{}}},member);assert.equal((await resolve(moai,'confirm',member)).status,'succeeded');
 });
 console.log(JSON.stringify({passed:checks,migration:'0041',rerun:true,productionWrites:0}));
}catch(e){console.error(e.message,e.detail||'',e.where||'');process.exitCode=1;}finally{await db.close();}
