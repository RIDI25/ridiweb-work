import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE?pathToFileURL(process.env.PGLITE_MODULE).href:'@electric-sql/pglite');const db=new PGlite();
const owner=randomUUID(),other=randomUUID();let passed=0;
const login=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};const admin=()=>login('','postgres');const service=()=>login('','service_role');
const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
const row=async(table,id)=>{await admin();return (await db.query(`select * from ${table} where id=$1`,[id])).rows[0];};
const conversation=async()=>{await login(owner);return (await db.query('insert into assistant_conversations(user_id) values($1) returning id',[owner])).rows[0].id;};
const begin=async(c,id=randomUUID(),text='기획해줘')=>{await login(owner);return {id,value:(await db.query('select begin_assistant_turn($1,$2,$3,$4) value',[c,id,text,'전체 업무'])).rows[0].value};};
const finish=async(id)=>{await service();return (await db.query("select finish_assistant_turn($1,'{\"ok\":true,\"text\":\"기획 초안입니다\"}') id",[id])).rows[0].id;};
const reserve=async(c,id=randomUUID(),bytes=100)=>{await login(owner);return (await db.query("select reserve_assistant_attachment($1,$2,'기획.pdf',$3,'application/pdf','pdf','pdf') value",[id,c,bytes])).rows[0].value;};
const ready=async(id)=>{await admin();await db.query("update assistant_attachments set status='ready',sha256=repeat('a',64),pages=1 where id=$1",[id]);};
const attach=async(c,ids,request=randomUUID())=>{await login(owner);return {id:request,value:(await db.query('select begin_assistant_turn_with_files($1,$2,$3,$4,$5) value',[c,request,'첨부 확인','전체 업무',ids])).rows[0].value};};
try{
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;create table profiles(id uuid primary key);create function is_team_member() returns boolean language sql security definer as $$select exists(select 1 from profiles where id=auth.uid())$$;create table assistant_action_requests(id uuid primary key,user_id uuid,display jsonb,result jsonb,status text,expires_at timestamptz);grant all on assistant_action_requests to service_role;create function resolve_assistant_action(request_id uuid,decision text) returns jsonb language plpgsql security definer as $$declare r assistant_action_requests;begin update assistant_action_requests set status=case when decision='confirm' then 'succeeded' else 'cancelled' end,result='{"message":"처리 완료"}' where id=request_id and user_id=auth.uid() returning * into r;if not found then raise exception 'forbidden';end if;return to_jsonb(r);end$$;`);
 await db.query('insert into profiles values($1),($2)',[owner,other]);const sql=await readFile(new URL('../migrations/0035_assistant_history_archives.sql',import.meta.url),'utf8');await db.exec(sql);

 await admin();await db.exec("create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon,service_role;grant all on storage.objects to authenticated,anon,service_role;create policy old_permissive on storage.objects for all to authenticated using(true) with check(true);");
 const migration=await readFile(new URL('../migrations/0042_assistant_attachments.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
 const c=await conversation(),c2=await conversation(),file=await reserve(c);
 await check('signed upload reservation is stable and same ID cannot change original metadata',async()=>{
  assert.equal((await reserve(c,file.id)).storage_path,file.storage_path);await assert.rejects(()=>reserve(c,file.id,101));await assert.rejects(()=>reserve(c2,file.id));
  await login(owner);await assert.rejects(()=>db.query("select reserve_assistant_attachment($1,$2,'x.pdf',10,'application/pdf','pdf','txt')",[randomUUID(),c]));
 });
 await check('browser cannot forge validation, attachment ownership, or read another user files',async()=>{
  await login(owner);await assert.rejects(()=>db.query("update assistant_attachments set status='ready',sha256=repeat('a',64)"));
  await login(other);assert.equal((await db.query('select * from assistant_attachments')).rows.length,0);
  await assert.rejects(()=>db.query("select reserve_assistant_attachment($1,$2,'x.pdf',10,'application/pdf','pdf','pdf')",[randomUUID(),c]));
 });
 await check('storage originals remain private even with an older broad permissive policy',async()=>{
  await admin();await db.query("insert into storage.objects(bucket_id) values('assistant-files'),('tracker')");await login(owner);
  assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows.map(r=>r.bucket_id),['tracker']);
  await assert.rejects(()=>db.query("insert into storage.objects(bucket_id) values('assistant-files')"));
  await admin();assert.equal((await db.query("select public from storage.buckets where id='assistant-files'")).rows[0].public,false);
 });
 await check('unvalidated files roll back the entire message and turn',async()=>{
  const request=randomUUID();await assert.rejects(()=>attach(c,[file.id],request));assert.equal(await row('assistant_messages',request),undefined);assert.equal((await row('assistant_conversations',c)).active_turn_id,null);
 });
 await ready(file.id);
 await check('ready files can only attach to their own conversation and duplicate IDs fail',async()=>{
  await assert.rejects(()=>attach(c2,[file.id]));await assert.rejects(()=>attach(c,[file.id,file.id]));
  await login(other);await assert.rejects(()=>db.query('select begin_assistant_turn_with_files($1,$2,$3,$4,$5)',[c,randomUUID(),'x','전체 업무',[file.id]]));
 });
 const turn=await attach(c,[file.id]);
 await check('one atomic message has verified metadata and replay cannot double-attach',async()=>{
  assert.equal(turn.value.status,'started');assert.equal((await row('assistant_attachments',file.id)).message_id,turn.id);
  assert.equal((await row('assistant_messages',turn.id)).metadata.attachments[0].sha256,'a'.repeat(64));
  assert.equal((await attach(c,[file.id],turn.id)).value.status,'running');await finish(turn.id);
  assert.equal((await attach(c,[file.id],turn.id)).value.status,'completed');await assert.rejects(()=>attach(c,[file.id]));
 });
 await check('expired uploads and more than 20MB fail without saving a message',async()=>{
  const expired=await reserve(c2);await ready(expired.id);await admin();await db.query("update assistant_attachments set expires_at=now()-interval '1 second' where id=$1",[expired.id]);await assert.rejects(()=>attach(c2,[expired.id]));
  const files=[];for(let i=0;i<3;i++){const f=await reserve(c2,randomUUID(),8*1024*1024);await ready(f.id);files.push(f.id);}await assert.rejects(()=>attach(c2,files));
  assert.equal((await row('assistant_conversations',c2)).active_turn_id,null);
 });
 await check('daily reservation quotas include abandoned attempts',async()=>{
  await admin();await db.query("insert into assistant_attachments(id,user_id,conversation_id,filename,bytes,mime,kind,storage_path) select gen_random_uuid(),$1,$2,'quota.pdf',100,'application/pdf','pdf',gen_random_uuid()::text from generate_series(1,50)",[owner,c2]);
  await assert.rejects(()=>reserve(c2));
 });
 console.log(JSON.stringify({passed,migration:'0042',rerun:true}));
}finally{await db.close();}
