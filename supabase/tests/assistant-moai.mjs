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
 for(const name of ['0033_assistant_confirmation_waiting.sql','0035_assistant_history_archives.sql','0037_moai.sql','0038_workspace_access.sql','0040_assistant_moai_actions.sql']) await db.exec(sql(name));
 await db.exec(sql('0040_assistant_moai_actions.sql'));
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
 const sessions=[5,12,19,26].map((day,i)=>({id:randomUUID(),title:`${i+1}회차`,date:`2026-11-${String(day).padStart(2,'0')}`,start:'10:00',end:'12:00',location:''}));
 const values={title:'Fixture Thursday study',kind:'study',period:'2026-11',theme:'',capacity:12,fee:0,sessions,checklist:[],plan:'보존할 기획',timetable:'보존할 시간표',survey:'보존할 설문',record:'',result:'',consent:'동의 안내',session_notes:{[sessions[0].id]:'보존할 회차 메모'}};
 let gatheringId,requestId;
 await check('operator sees own MoAI draft; one confirm creates gathering and four sessions atomically',async()=>{
  requestId=await draft('create_moai_gathering',{values},member);
  const conversation=randomUUID();await admin();await db.query("insert into assistant_conversations(id,user_id) values($1,$2)",[conversation,member]);await db.query('update assistant_action_requests set conversation_id=$1 where id=$2',[conversation,requestId]);
  assert.equal(await count('moai_gatherings'),0);
  await login(member);assert.equal((await db.query('select id from assistant_action_requests where id=$1',[requestId])).rows.length,1);
  const result=await resolve(requestId,'confirm',member);assert.equal(result.status,'succeeded');gatheringId=result.result.record_id;assert.equal(result.result.href,`/moai/${gatheringId}`);
  const g=await row('moai_gatherings',gatheringId);assert.equal(g.sessions.length,4);assert.equal(g.state,'draft');assert.equal(g.created_by,member);assert.equal(g.plan,values.plan);
  await resolve(requestId,'confirm',member);assert.equal(await count('moai_gatherings'),1);assert.equal(await count('moai_activity'),1);assert.equal(await count('assistant_messages','where id=$1',[requestId]),1);assert.equal(await count('events'),0);
 });
 await check('own-only draft isolation, forbidden Optify writes, no browser payload forgery',async()=>{
  await login(owner);assert.equal((await db.query('select * from assistant_action_requests where id=$1',[requestId])).rows.length,0);
  for(const user of [owner,outsider,'']) await assert.rejects(()=>resolve(requestId,'confirm',user));
  const optify=await draft('create_event',{title:'Forbidden',event_date:'2026-11-05',event_type:'meeting'},member);
  await login(member);assert.equal((await db.query('select * from assistant_action_requests where id=$1',[optify])).rows.length,0);
  await assert.rejects(()=>resolve(optify,'confirm',member),/옵티파이 변경 권한/);
  await assert.rejects(()=>db.query('update assistant_action_requests set payload=$1 where id=$2',['{}',requestId]));
  await assert.rejects(()=>db.query("insert into assistant_action_requests(user_id,tool_name,payload,display) values($1,'create_moai_gathering','{}','{}')",[member]));
  assert.equal(await count('events'),0);
 });
 await check('same-name separate drafts cannot duplicate a gathering',async()=>{
  const duplicate=await draft('create_moai_gathering',{values},owner);assert.equal((await resolve(duplicate)).status,'failed');assert.equal(await count('moai_gatherings'),1);
 });
 await check('schedule patch preserves documents, IDs, attendance and notes; resets approved state',async()=>{
  await login(member);await db.query('select moai_save_participant($1,null,null,$2)',[gatheringId,JSON.stringify({name:'Fixture',role:'participant',expected_fee:0,paid_amount:0,status:'confirmed',attendance:{[sessions[0].id]:'present'}})]);
  await db.query("select moai_transition($1,1,'request','')",[gatheringId]);await login(owner);await db.query("select moai_transition($1,2,'approve','')",[gatheringId]);
  const g=await row('moai_gatherings',gatheringId);const updated=[{...sessions[0],start:'11:00',end:'13:00'},...sessions.slice(1),{...sessions[0],id:randomUUID(),title:'5회차',date:'2026-12-03'}];
  const id=await draft('upsert_moai_sessions',{gathering_id:g.id,expected_version:g.version,sessions:updated},member);assert.equal((await resolve(id,'confirm',member)).status,'succeeded');
  const after=await row('moai_gatherings',g.id);assert.equal(after.state,'draft');assert.equal(after.approved_by,null);assert.equal(after.sessions.length,5);assert.equal(after.sessions[0].id,sessions[0].id);assert.equal(after.plan,values.plan);assert.equal(after.survey,values.survey);assert.deepEqual(after.session_notes,values.session_notes);
  await admin();assert.equal((await db.query('select attendance from moai_participants where gathering_id=$1',[g.id])).rows[0].attendance[sessions[0].id],'present');
 });
 await check('stale or archived gathering cannot be overwritten; removing untouched sessions is blocked',async()=>{
  const g=await row('moai_gatherings',gatheringId);const stale=await draft('upsert_moai_sessions',{gathering_id:g.id,expected_version:g.version-1,sessions:g.sessions});assert.equal((await resolve(stale)).status,'failed');
  const remove=await draft('upsert_moai_sessions',{gathering_id:g.id,expected_version:g.version,sessions:g.sessions.slice(0,1)});assert.equal((await resolve(remove)).status,'failed');
  const archived=await draft('upsert_moai_sessions',{gathering_id:g.id,expected_version:g.version,sessions:g.sessions});await admin();await db.query('update moai_gatherings set archived=true where id=$1',[g.id]);assert.equal((await resolve(archived)).status,'failed');await admin();await db.query('update moai_gatherings set archived=false where id=$1',[g.id]);assert.equal((await row('moai_gatherings',g.id)).version,g.version);
 });
 await check('cancel and expiry never create business records',async()=>{
  const cancelled=await draft('create_moai_gathering',{values:{...values,title:'Cancelled fixture'}},member);assert.equal((await resolve(cancelled,'cancel',member)).status,'cancelled');assert.equal((await resolve(cancelled,'confirm',member)).status,'cancelled');
  const expired=await draft('create_moai_gathering',{values:{...values,title:'Expired fixture'}},member,'2020-01-01');assert.equal((await resolve(expired,'confirm',member)).status,'expired');assert.equal(await count('moai_gatherings'),1);
 });
 await check('invalid combined create rolls back gathering, sessions and audit together',async()=>{
  const before=await count('moai_activity');const invalid=await draft('create_moai_gathering',{values:{...values,title:'Invalid fixture',sessions:[{...sessions[0],end:'09:00'}]}});assert.equal((await resolve(invalid)).status,'failed');assert.equal(await count('moai_gatherings'),1);assert.equal(await count('moai_activity'),before);
 });
 await check('membership is checked at confirmation and operator cannot perform final approval',async()=>{
  const denied=await draft('create_moai_gathering',{values:{...values,title:'No access'}},other);await assert.rejects(()=>resolve(denied,'confirm',other),/모아이 권한/);
  const revoked=await draft('create_moai_gathering',{values:{...values,title:'Revoked'}},member);await admin();await db.query('delete from moai_members where user_id=$1',[member]);await assert.rejects(()=>resolve(revoked,'confirm',member),/모아이 권한/);await admin();await db.query("insert into moai_members values($1,'operator')",[member]);await login(member);await assert.rejects(()=>db.query("select moai_transition($1,4,'approve','')",[gatheringId]),/모아이 권한/);
 });
 await check('existing Optify owner workflow still confirms normally',async()=>{
  const event=await draft('create_event',{title:'Fixture event',event_date:'2026-11-05',event_type:'meeting'});assert.equal((await resolve(event)).status,'succeeded');assert.equal(await count('events'),1);
 });
 console.log(JSON.stringify({passed:checks,migration:'0040',rerun:true,productionWrites:0}));
}catch(e){console.error(e.message,e.detail||'',e.where||'');process.exitCode=1;}finally{await db.close();}
