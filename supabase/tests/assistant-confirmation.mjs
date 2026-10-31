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
 const migration=sql('0033_assistant_confirmation_waiting.sql'); await db.exec(migration); await db.exec(migration);
 for(const [id,name,role] of [[owner,'Owner','owner'],[other,'Other','owner'],[member,'Member','member']]) {
  await db.query('insert into auth.users(id) values($1)',[id]); await db.query('insert into profiles(id,name,role) values($1,$2,$3)',[id,name,role]);
 }
 await db.query('insert into clients(id,name) values($1,$2)',[client,'Fixture customer']);
 const login=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`set role ${role}`);};
 const admin=()=>login('', 'postgres');
 const draft=async(tool,payload,user=owner,expires=null)=>{await admin(); const id=randomUUID();await db.query(`insert into assistant_action_requests(id,user_id,tool_name,payload,display,expires_at) values($1,$2,$3,$4,$5,coalesce($6::timestamptz,now()+interval '24 hours'))`,[id,user,tool,JSON.stringify(payload),JSON.stringify({title:tool,fields:[]}),expires]);return id;};
 const resolve=async(id,decision='confirm',user=owner)=>{await login(user);return (await db.query('select resolve_assistant_action($1,$2) as action',[id,decision])).rows[0].action;};
 const row=async(table,id)=>{await admin();return (await db.query(`select to_jsonb(t) as r from ${table} t where id=$1`,[id])).rows[0]?.r;};
 const count=async(table,where='',params=[])=>{await admin();return Number((await db.query(`select count(*) as n from ${table} ${where}`,params)).rows[0].n);};
 const taskPayload={title:'Fixture task',client_id:client,assignee_id:owner,due_date:'2026-11-02',status:'todo',task_type:'ops',priority:'normal',memo:null};
 let taskId;
 await check('draft is inert, confirm is idempotent and actor is recorded',async()=>{
  taskId=await draft('create_task',taskPayload);assert.equal(await count('tasks'),0);
  assert.equal((await resolve(taskId)).status,'succeeded');assert.equal((await resolve(taskId)).status,'succeeded');assert.equal(await count('tasks'),1);
  await login(owner);const activity=(await db.query('select * from task_activity where task_id=$1',[taskId])).rows;assert.equal(activity.length,1);assert.equal(activity[0].actor_id,owner);
 });
 await check('other user, non-team and anonymous cannot resolve or read private draft',async()=>{
  const id=await draft('create_task',taskPayload);
  for(const user of [other,outsider,'']) await assert.rejects(()=>resolve(id,'confirm',user));
  await login(other);assert.equal((await db.query('select id from assistant_action_requests where id=$1',[id])).rows.length,0);
 });
 await check('browser cannot forge, edit or delete requests/history',async()=>{
  await login(owner);
  await assert.rejects(()=>db.query('update assistant_action_requests set payload=$1 where id=$2',['{}',taskId]));
  await assert.rejects(()=>db.query('delete from assistant_action_requests where id=$1',[taskId]));
  await assert.rejects(()=>db.query('insert into assistant_action_requests(user_id,tool_name,payload,display) values($1,$2,$3,$4)',[owner,'create_task','{}','{}']));
  await assert.rejects(()=>db.query('delete from task_activity where task_id=$1',[taskId]));
 });
 await check('cancel and expiry are terminal',async()=>{
  const cancelled=await draft('create_task',taskPayload);assert.equal((await resolve(cancelled,'cancel')).status,'cancelled');assert.equal((await resolve(cancelled)).status,'cancelled');assert.equal(await row('tasks',cancelled),undefined);
  const expired=await draft('create_task',taskPayload,owner,'2020-01-01');assert.equal((await resolve(expired)).status,'expired');assert.equal(await row('tasks',expired),undefined);
 });
 await check('waiting preserves task status, captures history, completion clears waiting',async()=>{
  const task=await row('tasks',taskId);
  const id=await draft('set_task_waiting',{task_id:taskId,expected_updated_at:task.updated_at,waiting_on:'vendor',waiting_reason:'반영 일정 회신 대기',followup_date:'2026-11-04'});
  assert.equal((await resolve(id)).status,'succeeded');const waiting=await row('tasks',taskId);assert.equal(waiting.status,'todo');assert.equal(waiting.waiting_on,'vendor');assert.ok(waiting.waiting_since);
  const done=await draft('update_task_status',{task_id:taskId,expected_updated_at:waiting.updated_at,status:'done'});assert.equal((await resolve(done)).status,'succeeded');const complete=await row('tasks',taskId);assert.equal(complete.waiting_on,'none');assert.equal(complete.waiting_reason,null);assert.equal(complete.followup_date,null);
  assert.equal(await count('task_activity','where task_id=$1',[taskId]),3);
 });
 await check('stale task and deleted target cannot be overwritten',async()=>{
  const task=await row('tasks',taskId);const id=await draft('update_task_status',{task_id:taskId,expected_updated_at:task.updated_at,status:'todo'});
  await admin();await db.query('update tasks set title=$1 where id=$2',['Changed manually',taskId]);assert.equal((await resolve(id)).status,'failed');assert.equal((await row('tasks',taskId)).status,'done');
  const missing=await draft('update_task_status',{task_id:randomUUID(),expected_updated_at:task.updated_at,status:'todo'});assert.equal((await resolve(missing)).status,'failed');
 });
 await check('invalid waiting reason rolls back mutation and history',async()=>{
  const tId=await draft('create_task',taskPayload);await resolve(tId);const task=await row('tasks',tId);const before=await count('task_activity');
  const id=await draft('set_task_waiting',{task_id:tId,expected_updated_at:task.updated_at,waiting_on:'client',waiting_reason:'   '});assert.equal((await resolve(id)).status,'failed');assert.equal((await row('tasks',tId)).waiting_on,'none');assert.equal(await count('task_activity'),before);
 });
 const invoicePayload={issue_date:'2026-11-01',counterparty:'Fixture',supply_amount:1000,vat_amount:100,total_amount:1100,deal_channel:'direct'};
 let invoiceId;
 await check('invoice, lead, event and ledger writes preserve privileges and defaults',async()=>{
  invoiceId=await draft('add_tax_invoice',invoicePayload);assert.equal((await resolve(invoiceId)).status,'succeeded');assert.equal((await row('tax_invoices',invoiceId)).status,'issued');
  for(const [tool,payload] of [['add_lead',{company_name:'Fixture lead',deal_channel:'direct'}],['create_event',{title:'Fixture event',event_date:'2026-11-02',event_type:'meeting'}],['add_ledger_entry',{entry_date:'2026-11-01',amount:100,entry_type:'expense',payment_method:'card',category:'etc'}]])assert.equal((await resolve(await draft(tool,payload))).status,'succeeded');
  const forbidden=await draft('add_tax_invoice',invoicePayload,member);assert.equal((await resolve(forbidden,'confirm',member)).status,'failed');
  const allowed=await draft('add_ledger_entry',{entry_date:'2026-11-01',amount:100,entry_type:'expense',payment_method:'card',category:'etc'},member);assert.equal((await resolve(allowed,'confirm',member)).status,'succeeded');
 });
 await check('payment and invoice-paid status commit once together',async()=>{
  const invoice=await row('tax_invoices',invoiceId);const id=await draft('add_invoice_payment',{invoice_id:invoiceId,amount:1100,paid_date:'2026-11-01',kind:'full',expected_invoice:invoice,expected_paid:0});
  const result=await resolve(id);assert.equal(result.status,'succeeded',JSON.stringify(result.result));assert.equal((await resolve(id)).status,'succeeded');assert.equal(await count('invoice_payments','where invoice_id=$1',[invoiceId]),1);assert.equal((await row('tax_invoices',invoiceId)).status,'paid');
 });
 await check('manual payment invalidates prepared invoice snapshot',async()=>{
  const inv=await draft('add_tax_invoice',invoicePayload);await resolve(inv);const snapshot=await row('tax_invoices',inv);const id=await draft('add_invoice_payment',{invoice_id:inv,amount:100,paid_date:'2026-11-01',kind:'deposit',expected_invoice:snapshot,expected_paid:0});
  await admin();await db.query('insert into invoice_payments(invoice_id,paid_date,amount,kind) values($1,$2,$3,$4)',[inv,'2026-11-01',50,'other']);assert.equal((await resolve(id)).status,'failed');assert.equal(await count('invoice_payments','where invoice_id=$1',[inv]),1);
 });
 await check('payment failure rolls back invoice version and payment insert',async()=>{
  const inv=await draft('add_tax_invoice',invoicePayload);await resolve(inv);const snapshot=await row('tax_invoices',inv);const id=await draft('add_invoice_payment',{invoice_id:inv,amount:1100,paid_date:'2026-11-01',kind:'invalid',expected_invoice:snapshot,expected_paid:0});
  assert.equal((await resolve(id)).status,'failed');assert.deepEqual(await row('tax_invoices',inv),snapshot);assert.equal(await count('invoice_payments','where invoice_id=$1',[inv]),0);
 });
 await check('unknown tools and FK failures fail closed without partial task history',async()=>{
  assert.equal((await resolve(await draft('delete_everything',{}))).status,'failed');
  const id=await draft('create_task',{...taskPayload,client_id:randomUUID()});assert.equal((await resolve(id)).status,'failed');assert.equal(await row('tasks',id),undefined);assert.equal(await count('task_activity','where task_id=$1',[id]),0);
 });
 console.log(JSON.stringify({passed:checks,migration:'0033',database:'ephemeral PostgreSQL (PGlite)',migrationRerun:true}));
} finally { await db.close(); }
