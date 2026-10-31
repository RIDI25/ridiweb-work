begin;
create table if not exists public.assistant_conversations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 title text not null default '새 대화' check(length(title) between 1 and 200), pinned boolean not null default false,
 active_turn_id uuid, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.assistant_archives (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 week_start date not null, week_end date not null,
 status text not null default 'pending' check(status in ('pending','prepared','saved')),
 snapshot jsonb not null, summary text, transcript_hash text, summary_hash text,
 transcript_path text, summary_path text, saved_at timestamptz, next_attempt_at timestamptz, lease_token uuid, error text,
 created_at timestamptz not null default now(), unique(user_id,week_start)
);
create table if not exists public.assistant_messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
 role text not null check(role in ('user','assistant')), content text not null,
 context text not null default '전체 업무', metadata jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(), archive_id uuid references public.assistant_archives(id)
);
create table if not exists public.assistant_turns (
 id uuid primary key, conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
 status text not null default 'running' check(status in ('running','completed','failed')),
 assistant_message_id uuid references public.assistant_messages(id), created_at timestamptz not null default now()
);
alter table public.assistant_action_requests add column if not exists conversation_id uuid references public.assistant_conversations(id) on delete set null;
create index if not exists assistant_messages_history on public.assistant_messages(conversation_id,created_at,id);
create index if not exists assistant_messages_unarchived on public.assistant_messages(created_at) where archive_id is null;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_turns enable row level security;
alter table public.assistant_archives enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='assistant_conversations' and policyname='own_conversations') then
  create policy own_conversations on public.assistant_conversations for select to authenticated using(user_id=auth.uid() and public.is_team_member());
  create policy create_conversations on public.assistant_conversations for insert to authenticated with check(user_id=auth.uid() and public.is_team_member());
  create policy edit_conversations on public.assistant_conversations for update to authenticated using(user_id=auth.uid() and public.is_team_member()) with check(user_id=auth.uid() and public.is_team_member());
  create policy own_messages on public.assistant_messages for select to authenticated using(exists(select 1 from public.assistant_conversations c where c.id=conversation_id));
  create policy own_turns on public.assistant_turns for select to authenticated using(exists(select 1 from public.assistant_conversations c where c.id=conversation_id));
  create policy own_archives on public.assistant_archives for select to authenticated using(user_id=auth.uid() and public.is_team_member());
 end if;
end $$;
revoke all on public.assistant_conversations,public.assistant_messages,public.assistant_turns,public.assistant_archives from anon,authenticated;
grant select on public.assistant_conversations,public.assistant_messages,public.assistant_turns,public.assistant_archives to authenticated;
grant insert(user_id,title) on public.assistant_conversations to authenticated;
grant update(title,pinned) on public.assistant_conversations to authenticated;
grant all on public.assistant_conversations,public.assistant_messages,public.assistant_turns,public.assistant_archives to service_role;

create or replace function public.expire_assistant_turn(p_conversation uuid) returns void language plpgsql security definer set search_path=public as $$
declare c public.assistant_conversations; t public.assistant_turns; mid uuid;
begin
 select * into c from public.assistant_conversations where id=p_conversation and user_id=auth.uid() and public.is_team_member() for update;
 if not found then raise exception 'Conversation not found'; end if;
 select * into t from public.assistant_turns where id=c.active_turn_id and status='running' and created_at<now()-interval '3 minutes';
 if found then
  insert into public.assistant_messages(conversation_id,role,content,metadata) values(c.id,'assistant','응답을 끝내지 못했어요. 요청은 저장돼 있어요. 확인 대기 중인 작업이 있는지 확인하고 다시 요청해 주세요.','{"ok":false}') returning id into mid;
  update public.assistant_turns set status='failed',assistant_message_id=mid where id=t.id;
  update public.assistant_conversations set active_turn_id=null,updated_at=clock_timestamp() where id=c.id;
 end if;
end $$;
create or replace function public.begin_assistant_turn(p_conversation uuid,p_request uuid,p_content text,p_context text default '전체 업무') returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.assistant_conversations; t public.assistant_turns;
begin
 if length(btrim(p_content)) not between 1 and 8000 or length(p_context)>200 then raise exception 'Invalid message'; end if;
 perform public.expire_assistant_turn(p_conversation);
 select * into c from public.assistant_conversations where id=p_conversation and user_id=auth.uid() and archived_at is null and public.is_team_member() for update;
 if not found then raise exception 'Conversation not found'; end if;
 select * into t from public.assistant_turns where id=p_request;
 if found then
  if t.conversation_id<>c.id then raise exception 'Request does not belong to this conversation'; end if;
  return jsonb_build_object('status',t.status,'message_id',t.assistant_message_id);
 end if;
 if c.active_turn_id is not null then return jsonb_build_object('status','busy'); end if;
 insert into public.assistant_turns(id,conversation_id) values(p_request,c.id);
 insert into public.assistant_messages(id,conversation_id,role,content,context) values(p_request,c.id,'user',p_content,p_context);
 update public.assistant_conversations set active_turn_id=p_request,updated_at=clock_timestamp(),title=case when title='새 대화' then left(p_content,70) else title end where id=c.id;
 return jsonb_build_object('status','started');
end $$;
create or replace function public.finish_assistant_turn(p_request uuid,p_response jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare t public.assistant_turns; mid uuid;
begin
 perform 1 from public.assistant_conversations where id=(select conversation_id from public.assistant_turns where id=p_request) for update;
 select * into t from public.assistant_turns where id=p_request for update;
 if not found then raise exception 'Turn not found'; end if;
 if t.status<>'running' then return t.assistant_message_id; end if;
 insert into public.assistant_messages(conversation_id,role,content,metadata)
 values(t.conversation_id,'assistant',coalesce(nullif(p_response->>'text',''),p_response->>'error','응답을 완료하지 못했어요.'),p_response) returning id into mid;
 update public.assistant_turns set status='completed',assistant_message_id=mid where id=p_request;
 update public.assistant_conversations set active_turn_id=null,updated_at=clock_timestamp() where id=t.conversation_id and active_turn_id=p_request;
 return mid;
end $$;
revoke all on function public.expire_assistant_turn(uuid),public.begin_assistant_turn(uuid,uuid,text,text) from public,anon;
grant execute on function public.expire_assistant_turn(uuid),public.begin_assistant_turn(uuid,uuid,text,text) to authenticated;
revoke all on function public.finish_assistant_turn(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_assistant_turn(uuid,jsonb) to service_role;

create or replace function public.claim_assistant_archive(p_archive uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare a public.assistant_archives;
begin
 update public.assistant_archives set lease_token=gen_random_uuid(),next_attempt_at=now()+interval '15 minutes'
 where id=p_archive and status<>'saved' and (next_attempt_at is null or next_attempt_at<=now()) returning * into a;
 if not found then return null; end if;
 return to_jsonb(a);
end $$;
revoke all on function public.claim_assistant_archive(uuid) from public,anon,authenticated;
grant execute on function public.claim_assistant_archive(uuid) to service_role;
-- Freeze a complete week before generating/writing files. Messages remain untouched until receipt.
create or replace function public.prepare_assistant_archive(p_owner uuid,p_week date) returns uuid language plpgsql security invoker set search_path=public as $$
declare aid uuid; snapshot jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,35));
 select id into aid from public.assistant_archives where user_id=p_owner and week_start=p_week;
 if found then return aid; end if;
 select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) into snapshot from (
  select m.id,m.conversation_id,c.title,m.role,m.content,m.context,m.metadata,m.created_at
  from public.assistant_messages m join public.assistant_conversations c on c.id=m.conversation_id
  where c.user_id=p_owner and m.archive_id is null
   and m.created_at >= (p_week::timestamp at time zone 'Asia/Seoul') and m.created_at < ((p_week+7)::timestamp at time zone 'Asia/Seoul')
 ) x;
 if snapshot is null then return null; end if;
 insert into public.assistant_archives(user_id,week_start,week_end,snapshot) values(p_owner,p_week,p_week+7,snapshot) returning id into aid;
 return aid;
end $$;
create or replace function public.acknowledge_assistant_archive(p_archive uuid,p_transcript_hash text,p_summary_hash text,p_lease uuid) returns integer language plpgsql security invoker set search_path=public as $$
declare a public.assistant_archives; n integer;
begin
 select * into a from public.assistant_archives where id=p_archive for update;
 if not found or a.status not in ('prepared','saved') or a.transcript_hash is distinct from p_transcript_hash or a.summary_hash is distinct from p_summary_hash or a.transcript_path is null or a.summary_path is null then raise exception 'Verified file receipt required'; end if;
 if a.status='saved' then return 0; end if;
 if a.lease_token is distinct from p_lease then raise exception 'Archive lease changed'; end if;
 update public.assistant_messages m set archive_id=a.id from public.assistant_conversations c
 where m.conversation_id=c.id and c.user_id=a.user_id and m.archive_id is null and exists(select 1 from jsonb_array_elements(a.snapshot) s where (s->>'id')::uuid=m.id);
 -- Pinning and new messages are checked again now, after the local files were verified.
 update public.assistant_conversations c set archived_at=clock_timestamp()
 where c.user_id=a.user_id and not c.pinned and c.active_turn_id is null and c.archived_at is null
 and exists(select 1 from public.assistant_messages m where m.conversation_id=c.id and m.archive_id=a.id)
 and not exists(select 1 from public.assistant_messages m where m.conversation_id=c.id and m.archive_id is null)
 and not exists(select 1 from public.assistant_action_requests r where r.conversation_id=c.id and r.status='pending' and r.expires_at>now());
 get diagnostics n = row_count;
 update public.assistant_archives set status='saved',saved_at=clock_timestamp(),error=null,next_attempt_at=null where id=a.id;
 return n;
end $$;
revoke all on function public.prepare_assistant_archive(uuid,date),public.acknowledge_assistant_archive(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_assistant_archive(uuid,date),public.acknowledge_assistant_archive(uuid,text,text,uuid) to service_role;
create or replace function public.resolve_chat_assistant_action(request_id uuid,decision text) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; r public.assistant_action_requests;
begin
 result := public.resolve_assistant_action(request_id,decision);
 select * into r from public.assistant_action_requests where id=request_id and user_id=auth.uid();
 if r.conversation_id is not null and r.status<>'pending' then
  insert into public.assistant_messages(id,conversation_id,role,content,metadata)
  values(r.id,r.conversation_id,'assistant',coalesce(r.display->>'title','작업') || ': ' || coalesce(r.result->>'message',case when r.status='cancelled' then '취소했어요.' else r.status end),jsonb_build_object('action_result',jsonb_build_object('id',r.id,'status',r.status,'result',r.result))) on conflict(id) do nothing;
  if found then update public.assistant_conversations set updated_at=clock_timestamp(),archived_at=null where id=r.conversation_id; end if;
 end if;
 return result;
end $$;
revoke all on function public.resolve_chat_assistant_action(uuid,text) from public,anon;
grant execute on function public.resolve_chat_assistant_action(uuid,text) to authenticated;
create or replace function public.tidy_archived_assistant_conversations(p_owner uuid) returns integer language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
 update public.assistant_conversations c set archived_at=clock_timestamp() where c.user_id=p_owner and c.archived_at is null and not c.pinned and c.active_turn_id is null
 and exists(select 1 from public.assistant_messages m join public.assistant_archives a on a.id=m.archive_id where m.conversation_id=c.id and a.status='saved')
 and not exists(select 1 from public.assistant_messages m where m.conversation_id=c.id and m.archive_id is null)
 and not exists(select 1 from public.assistant_action_requests r where r.conversation_id=c.id and r.status='pending' and r.expires_at>now());
 get diagnostics n = row_count; return n;
end $$;
revoke all on function public.tidy_archived_assistant_conversations(uuid) from public,anon,authenticated;
grant execute on function public.tidy_archived_assistant_conversations(uuid) to service_role;
commit;
