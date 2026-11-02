-- Private originals, server-validated content and atomic attachment/message association.
begin;
create table if not exists public.assistant_attachments (
 id uuid primary key, user_id uuid not null references public.profiles(id),
 conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
 message_id uuid references public.assistant_messages(id) on delete cascade,
 filename text not null check(length(filename) between 1 and 200 and filename !~ '[[:cntrl:]/\\]'),
 bytes bigint not null check(bytes between 1 and 10485760), mime text not null,
 kind text not null check(kind in ('image','pdf','text')), storage_path text not null unique,
 status text not null default 'uploading' check(status in ('uploading','ready','failed')),
 sha256 text check(sha256 ~ '^[0-9a-f]{64}$'), extracted_text text not null default '' check(length(extracted_text)<=200000),
 pages integer check(pages between 1 and 30), note text not null default '',
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
 check(kind<>'image' or bytes<=5242880), check(status<>'ready' or sha256 is not null)
);
create index if not exists assistant_attachments_conversation on public.assistant_attachments(user_id,conversation_id,created_at);
alter table public.assistant_attachments enable row level security;
drop policy if exists own_assistant_attachments on public.assistant_attachments;
create policy own_assistant_attachments on public.assistant_attachments for select to authenticated using(user_id=auth.uid() and public.is_team_member());
revoke all on public.assistant_attachments from public,anon,authenticated;
grant select on public.assistant_attachments to authenticated;
grant all on public.assistant_attachments to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('assistant-files','assistant-files',false,10485760)
 on conflict(id) do update set public=false,file_size_limit=10485760;
-- No browser storage policy: short-lived signed upload/download URLs follow an ownership check.
drop policy if exists assistant_files_private on storage.objects;
create policy assistant_files_private on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'assistant-files') with check(bucket_id<>'assistant-files');
create or replace function public.reserve_assistant_attachment(p_id uuid,p_conversation uuid,p_filename text,p_bytes bigint,p_mime text,p_kind text,p_ext text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.assistant_attachments; n bigint; total bigint;
begin
 perform 1 from public.profiles where id=auth.uid() for update;
 if not found then raise exception 'Login required';end if;
 perform 1 from public.assistant_conversations where id=p_conversation and user_id=auth.uid() and archived_at is null;
 if not found then raise exception 'Conversation not found';end if;
 if p_ext is null or p_ext not in ('png','jpg','jpeg','webp','gif','pdf','txt','md','csv','json','docx','xlsx','xls','pptx','hwpx') or lower(substring(p_filename from '[^.]+$'))<>p_ext then raise exception 'Unsupported file';end if;
 select * into f from public.assistant_attachments where id=p_id;
 if found then
  if f.user_id<>auth.uid() or f.conversation_id<>p_conversation or f.filename<>p_filename or f.bytes<>p_bytes or f.mime<>p_mime or f.kind<>p_kind or f.status='failed' or f.message_id is not null or f.expires_at<=now() then raise exception 'Upload is no longer available';end if;
  return to_jsonb(f);
 end if;
 select count(*),coalesce(sum(bytes),0) into n,total from public.assistant_attachments where user_id=auth.uid() and created_at>now()-interval '24 hours';
 if n>=50 or total+p_bytes>209715200 then raise exception 'Daily upload limit';end if;
 insert into public.assistant_attachments(id,user_id,conversation_id,filename,bytes,mime,kind,storage_path)
 values(p_id,auth.uid(),p_conversation,p_filename,p_bytes,p_mime,p_kind,auth.uid()::text||'/'||p_id::text||'/source.'||p_ext) returning * into f;
 return to_jsonb(f);
end $$;
revoke all on function public.reserve_assistant_attachment(uuid,uuid,text,bigint,text,text,text) from public,anon;
grant execute on function public.reserve_assistant_attachment(uuid,uuid,text,bigint,text,text,text) to authenticated;
create or replace function public.begin_assistant_turn_with_files(p_conversation uuid,p_request uuid,p_content text,p_context text,p_files uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; file_meta jsonb; n integer; total bigint;
begin
 if p_files is null or cardinality(p_files)>5 or array_position(p_files,null) is not null or cardinality(p_files)<>(select count(distinct x) from unnest(p_files) x) then raise exception 'Invalid attachments';end if;
 r:=public.begin_assistant_turn(p_conversation,p_request,p_content,p_context);
 if r->>'status'<>'started' then return r;end if;
 perform 1 from public.assistant_attachments where id=any(p_files) order by id for update;
 select count(*),coalesce(sum(bytes),0) into n,total from public.assistant_attachments where id=any(p_files) and user_id=auth.uid() and conversation_id=p_conversation and message_id is null and status='ready' and expires_at>now();
 if n<>cardinality(p_files) or total>20971520 then raise exception 'Attachments not ready or do not belong to this conversation';end if;
 if n>0 then
  update public.assistant_attachments set message_id=p_request where id=any(p_files);
  select jsonb_agg(jsonb_build_object('id',id,'filename',filename,'bytes',bytes,'mime',mime,'kind',kind,'sha256',sha256,'pages',pages,'note',note) order by array_position(p_files,id)) into file_meta from public.assistant_attachments where id=any(p_files);
  update public.assistant_messages set metadata=jsonb_build_object('attachments',file_meta) where id=p_request;
 end if;
 return r;
end $$;
revoke all on function public.begin_assistant_turn_with_files(uuid,uuid,text,text,uuid[]) from public,anon;
grant execute on function public.begin_assistant_turn_with_files(uuid,uuid,text,text,uuid[]) to authenticated;
commit;
