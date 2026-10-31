-- Team meetings and private, read-only Obsidian search copies.
begin;
create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  meeting_date date not null,
  participants text not null default '' check (length(participants) <= 1000),
  body text not null default '' check (length(body) <= 60000),
  archived boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create table if not exists public.vault_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  vault_name text not null,
  path text not null,
  title text not null,
  body text not null check (length(body) <= 1000000),
  content_hash text not null,
  source_modified_at timestamptz not null,
  synced_at timestamptz not null default now(),
  unique(owner_id, path)
);
create table if not exists public.vault_sync_state (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  vault_name text not null,
  note_count integer not null default 0,
  skipped_count integer not null default 0,
  last_success_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  error text
);
alter table public.meeting_notes enable row level security;
alter table public.vault_notes enable row level security;
alter table public.vault_sync_state enable row level security;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='meeting_notes' and policyname='meetings_read') then
    create policy meetings_read on public.meeting_notes for select to authenticated using(public.is_team_member());
    create policy meetings_insert on public.meeting_notes for insert to authenticated with check(public.is_team_member() and created_by=auth.uid());
    create policy meetings_update on public.meeting_notes for update to authenticated using(public.is_team_member()) with check(public.is_team_member());
    create policy vault_private_read on public.vault_notes for select to authenticated using(owner_id=auth.uid() and public.is_team_member());
    create policy vault_state_private_read on public.vault_sync_state for select to authenticated using(owner_id=auth.uid() and public.is_team_member());
  end if;
end $$;
revoke all on public.meeting_notes,public.vault_notes,public.vault_sync_state from anon,authenticated;
grant select on public.meeting_notes,public.vault_notes,public.vault_sync_state to authenticated;
grant insert(title,meeting_date,client_id,participants,body,created_by) on public.meeting_notes to authenticated;
grant update(title,meeting_date,client_id,participants,body,archived) on public.meeting_notes to authenticated;
grant all on public.meeting_notes,public.vault_notes,public.vault_sync_state to service_role;
create or replace function public.meeting_note_version() returns trigger language plpgsql set search_path=public as $$
begin
  new.version := old.version+1;
  new.updated_at := clock_timestamp();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgname='meeting_note_version_trigger' and tgrelid='public.meeting_notes'::regclass) then
    create trigger meeting_note_version_trigger before update on public.meeting_notes for each row execute function public.meeting_note_version();
  end if;
end $$;
create index if not exists meetings_date on public.meeting_notes(meeting_date desc);

-- One transaction: only a complete successful local scan may replace the search index.
create or replace function public.sync_vault_notes(p_owner uuid,p_vault text,p_notes jsonb,p_skipped integer default 0)
returns integer language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  if jsonb_typeof(p_notes) <> 'array' or jsonb_array_length(p_notes)>5000 or length(p_vault)=0 then raise exception 'Invalid vault snapshot'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,34));
  insert into public.vault_notes(owner_id,vault_name,path,title,body,content_hash,source_modified_at)
  select p_owner,p_vault,x.path,x.title,x.body,x.content_hash,x.source_modified_at
  from jsonb_to_recordset(p_notes) as x(path text,title text,body text,content_hash text,source_modified_at timestamptz)
  on conflict(owner_id,path) do update set vault_name=excluded.vault_name,title=excluded.title,body=excluded.body,content_hash=excluded.content_hash,source_modified_at=excluded.source_modified_at,synced_at=now()
  where vault_notes.content_hash is distinct from excluded.content_hash or vault_notes.source_modified_at is distinct from excluded.source_modified_at or vault_notes.vault_name is distinct from excluded.vault_name;
  delete from public.vault_notes v where v.owner_id=p_owner and not exists(select 1 from jsonb_array_elements(p_notes) x where x->>'path'=v.path);
  n := jsonb_array_length(p_notes);
  insert into public.vault_sync_state(owner_id,vault_name,note_count,skipped_count,last_success_at,last_attempt_at,error)
  values(p_owner,p_vault,n,p_skipped,now(),now(),null)
  on conflict(owner_id) do update set vault_name=excluded.vault_name,note_count=n,skipped_count=p_skipped,last_success_at=now(),last_attempt_at=now(),error=null;
  return n;
end $$;
revoke all on function public.sync_vault_notes(uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.sync_vault_notes(uuid,text,jsonb,integer) to service_role;

-- Invoker rights deliberately retain the caller's RLS, including between two owners.
create or replace function public.search_workspace_notes(p_query text default '',p_source text default 'all',p_limit integer default 8)
returns table(id uuid,source text,title text,path text,excerpt text,updated_at timestamptz)
language sql stable security invoker set search_path=public as $$
with terms as (select regexp_split_to_array(lower(left(btrim(coalesce(p_query,'')),120)),E'\\s+') as words),
notes as (
 select v.id,'vault'::text source,v.title,v.path,v.body,v.source_modified_at updated_at from public.vault_notes v where p_source in ('all','vault')
 union all
 select m.id,'meeting'::text,m.title,m.meeting_date::text || ' · 회의록',m.body || E'\n참석자: ' || m.participants,m.updated_at from public.meeting_notes m where not m.archived and p_source in ('all','meeting')
), matched as (
 select n.*,t.words,case when words[1]<>'' then position(words[1] in lower(n.body)) else 1 end as hit
 from notes n cross join terms t
 where not exists(select 1 from unnest(t.words) word where word<>'' and position(word in lower(n.title||' '||n.path||' '||n.body))=0)
)
select id,source,title,path,substring(body from greatest(1,hit-100) for 650),updated_at
from matched order by (case when words[1]<>'' and position(words[1] in lower(title))>0 then 0 else 1 end),updated_at desc,id
limit greatest(1,least(coalesce(p_limit,8),30));
$$;
revoke all on function public.search_workspace_notes(text,text,integer) from public,anon;
grant execute on function public.search_workspace_notes(text,text,integer) to authenticated;
commit;
