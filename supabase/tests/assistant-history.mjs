import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');const db=new PGlite();
const owner=randomUUID(),other=randomUUID();let passed=0;
const login=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};const admin=()=>login('','postgres');const service=()=>login('','service_role');
const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
const row=async(table,id)=>{await admin();return (await db.query(`select * from ${table} where id=$1`,[id])).rows[0];};
const conversation=async()=>{await login(owner);return (await db.query('insert into assistant_conversations(user_id) values($1) returning id',[owner])).rows[0].id;};
const begin=async(c,id=randomUUID(),text='기획해줘')=>{await login(owner);return {id,value:(await db.query('select begin_assistant_turn($1,$2,$3,$4) value',[c,id,text,'전체 업무'])).rows[0].value};};
const finish=async(id)=>{await service();return (await db.query("select finish_assistant_turn($1,'{\"ok\":true,\"text\":\"기획 초안입니다\"}') id",[id])).rows[0].id;};
const old=async(c)=>{await admin();await db.query("update assistant_messages set created_at='2026-10-20T00:00:00Z' where conversation_id=$1",[c]);};
try{
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;create table profiles(id uuid primary key);create function is_team_member() returns boolean language sql security definer as $$select exists(select 1 from profiles where id=auth.uid())$$;create table assistant_action_requests(id uuid primary key,user_id uuid,display jsonb,result jsonb,status text,expires_at timestamptz);grant all on assistant_action_requests to service_role;create function resolve_assistant_action(request_id uuid,decision text) returns jsonb language plpgsql security definer as $$declare r assistant_action_requests;begin update assistant_action_requests set status=case when decision='confirm' then 'succeeded' else 'cancelled' end,result='{"message":"처리 완료"}' where id=request_id and user_id=auth.uid() returning * into r;if not found then raise exception 'forbidden';end if;return to_jsonb(r);end$$;`);
 await db.query('insert into profiles values($1),($2)',[owner,other]);const sql=await readFile(new URL('../migrations/0035_assistant_history_archives.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 const c=await conversation();const t=await begin(c);
 await check('message saved before inference, request idempotent and competing request blocked',async()=>{
  assert.equal(t.value.status,'started');assert.equal((await begin(c,t.id)).value.status,'running');assert.equal((await begin(c)).value.status,'busy');await admin();assert.equal((await db.query('select * from assistant_messages where conversation_id=$1',[c])).rows.length,1);
 });
 await check('other owner cannot read or start private conversation',async()=>{
  await login(other);assert.equal((await db.query('select * from assistant_messages')).rows.length,0);assert.equal((await db.query('select * from assistant_conversations')).rows.length,0);await assert.rejects(()=>db.query('select begin_assistant_turn($1,$2,$3,$4)',[c,randomUUID(),'x','전체 업무']));
 });
 await check('browser cannot forge assistant messages, finish turns or archive',async()=>{
  await login(owner);await assert.rejects(()=>db.query("insert into assistant_messages(conversation_id,role,content) values($1,'assistant','fake')",[c]));await assert.rejects(()=>db.query('select finish_assistant_turn($1,$2)',[t.id,'{}']));await assert.rejects(()=>db.query('delete from assistant_messages'));await assert.rejects(()=>db.query('select prepare_assistant_archive($1,$2)',[owner,'2026-10-19']));
 });
 const mid=await finish(t.id);
 await check('completion is persisted once and retry reuses stored answer',async()=>{assert.equal(await finish(t.id),mid);const retry=await begin(c,t.id);assert.equal(retry.value.status,'completed');assert.equal(retry.value.message_id,mid);});
 await check('expired inference stores a failure and releases conversation',async()=>{
  const next=await begin(c);await admin();await db.query("update assistant_turns set created_at=now()-interval '4 minutes' where id=$1",[next.id]);await login(owner);await db.query('select expire_assistant_turn($1)',[c]);assert.equal((await row('assistant_turns',next.id)).status,'failed');assert.equal((await row('assistant_conversations',c)).active_turn_id,null);
 });
 await check('action confirmation is recorded once in conversation history',async()=>{
  const id=randomUUID();await admin();await db.query("insert into assistant_action_requests(id,user_id,conversation_id,display,status,expires_at) values($1,$2,$3,'{\"title\":\"업무 등록\"}','pending',now()+interval '1 day')",[id,owner,c]);await login(owner);await db.query("select resolve_chat_assistant_action($1,'confirm')",[id]);await db.query("select resolve_chat_assistant_action($1,'confirm')",[id]);assert.equal((await row('assistant_messages',id)).content,'업무 등록: 처리 완료');
 });
 const pinned=await conversation();await finish((await begin(pinned)).id);
 const changed=await conversation();await finish((await begin(changed)).id);
 const waiting=await conversation();await finish((await begin(waiting)).id);
 for(const id of [c,pinned,changed,waiting])await old(id);
 await service();const aid=(await db.query('select prepare_assistant_archive($1,$2) id',[owner,'2026-10-19'])).rows[0].id;
 let claim;
 await check('archive preparation is inert and only one worker can claim it',async()=>{
  assert.equal((await row('assistant_conversations',c)).archived_at,null);await service();claim=(await db.query('select claim_assistant_archive($1) a',[aid])).rows[0].a;assert.ok(claim.lease_token);assert.equal((await db.query('select claim_assistant_archive($1) a',[aid])).rows[0].a,null);assert.ok(claim.snapshot.some(m=>m.content==='업무 등록: 처리 완료'));
 });
 await check('missing/wrong file receipts cannot hide conversations',async()=>{
  await service();await assert.rejects(()=>db.query('select acknowledge_assistant_archive($1,$2,$3,$4)',[aid,'raw','summary',claim.lease_token]));assert.equal((await row('assistant_conversations',c)).archived_at,null);
  await service();await db.query("update assistant_archives set status='prepared',transcript_hash='raw',summary_hash='summary',transcript_path='raw.md',summary_path='summary.md' where id=$1",[aid]);await assert.rejects(()=>db.query('select acknowledge_assistant_archive($1,$2,$3,$4)',[aid,'wrong','summary',claim.lease_token]));
 });
 await login(owner);await db.query('update assistant_conversations set pinned=true where id=$1',[pinned]);await finish((await begin(changed)).id);
 const pendingId=randomUUID();await admin();await db.query("insert into assistant_action_requests(id,user_id,conversation_id,status,expires_at) values($1,$2,$3,'pending',now()+interval '1 day')",[pendingId,owner,waiting]);
 await check('verified receipt hides only unpinned completed conversations without new messages or pending approvals',async()=>{
  await service();const n=(await db.query('select acknowledge_assistant_archive($1,$2,$3,$4) n',[aid,'raw','summary',claim.lease_token])).rows[0].n;assert.equal(n,1);assert.ok((await row('assistant_conversations',c)).archived_at);assert.equal((await row('assistant_conversations',pinned)).archived_at,null);assert.equal((await row('assistant_conversations',changed)).archived_at,null);assert.equal((await row('assistant_conversations',waiting)).archived_at,null);
  await service();assert.equal((await db.query('select acknowledge_assistant_archive($1,$2,$3,$4) n',[aid,'raw','summary',claim.lease_token])).rows[0].n,0);
 });
 await check('unpin and expired approvals tidy only already exported history',async()=>{
  await login(owner);await db.query('update assistant_conversations set pinned=false where id=$1',[pinned]);await admin();await db.query("update assistant_action_requests set expires_at=now()-interval '1 hour' where id=$1",[pendingId]);await service();assert.equal((await db.query('select tidy_archived_assistant_conversations($1) n',[owner])).rows[0].n,2);assert.equal((await row('assistant_conversations',changed)).archived_at,null);
 });
 await check('archived conversation remains recoverable in database but cannot accept new messages',async()=>{await login(owner);assert.ok((await db.query('select * from assistant_messages where conversation_id=$1',[c])).rows.length>0);await assert.rejects(()=>db.query('select begin_assistant_turn($1,$2,$3,$4)',[c,randomUUID(),'x','전체 업무']));});
 console.log(JSON.stringify({passed,migration:'0035',rerun:true}));
}finally{await db.close();}
