-- Private lecture workspace. Existing Optify/MoAI access is not changed.
begin;
create table if not exists public.lecture_projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
 title text not null check(length(btrim(title)) between 1 and 200),
 origin text not null check(origin in ('proposal','inquiry')),
 stage text not null check(stage in ('expected','drafting','sent','discussing','confirmed','preparing','completed','cancelled')),
 organization text not null default '' check(length(organization)<=200), contact text not null default '' check(length(contact)<=1000),
 audience text not null default '' check(length(audience)<=1000), brief text not null default '' check(length(brief)<=20000), fee text not null default '' check(length(fee)<=1000),
 next_action text not null default '' check(length(next_action)<=500), next_action_date date,
 sessions jsonb not null default '[]' check(jsonb_typeof(sessions)='array' and jsonb_array_length(sessions)<=80 and octet_length(sessions::text)<=100000),
 checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=80 and octet_length(checklist::text)<=100000),
 history_verified boolean not null default false check(not history_verified or stage='completed'), archived boolean not null default false,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create table if not exists public.lecture_documents (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id), project_id uuid,
 kind text not null check(kind in ('proposal','curriculum','profile','materials','record')),
 title text not null check(length(btrim(title)) between 1 and 200), body text not null default '' check(length(body)<=60000),
 status text not null default 'draft' check(status in ('draft','final')), archived boolean not null default false,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.lecture_projects(id,owner_id), unique(id,owner_id)
);
create table if not exists public.lecture_document_revisions (
 id uuid primary key default gen_random_uuid(), document_id uuid not null, owner_id uuid not null,
 title text not null, body text not null, status text not null, version integer not null, saved_at timestamptz not null default now(),
 foreign key(document_id,owner_id) references public.lecture_documents(id,owner_id), unique(document_id,version)
);
alter table public.lecture_projects enable row level security;
alter table public.lecture_documents enable row level security;
alter table public.lecture_document_revisions enable row level security;
do $$ declare t text; begin
 foreach t in array array['lecture_projects','lecture_documents'] loop
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_read') then
   execute format('create policy %I on public.%I for select to authenticated using(owner_id=auth.uid() and public.is_team_member())',t||'_read',t);
   execute format('create policy %I on public.%I for insert to authenticated with check(owner_id=auth.uid() and public.is_team_member())',t||'_insert',t);
   execute format('create policy %I on public.%I for update to authenticated using(owner_id=auth.uid() and public.is_team_member()) with check(owner_id=auth.uid() and public.is_team_member())',t||'_update',t);
  end if;
 end loop;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='lecture_document_revisions' and policyname='lecture_revisions_read') then
  create policy lecture_revisions_read on public.lecture_document_revisions for select to authenticated using(owner_id=auth.uid() and public.is_team_member());
 end if;
end $$;
revoke all on public.lecture_projects,public.lecture_documents,public.lecture_document_revisions from anon,authenticated;
grant select on public.lecture_projects,public.lecture_documents,public.lecture_document_revisions to authenticated;
grant insert(owner_id,title,origin,stage,organization,contact,audience,brief,fee,next_action,next_action_date,sessions,checklist,history_verified,archived) on public.lecture_projects to authenticated;
grant update(title,origin,stage,organization,contact,audience,brief,fee,next_action,next_action_date,sessions,checklist,history_verified,archived) on public.lecture_projects to authenticated;
grant insert(owner_id,project_id,kind,title,body,status,archived) on public.lecture_documents to authenticated;
grant update(title,body,status,archived) on public.lecture_documents to authenticated;
grant all on public.lecture_projects,public.lecture_documents,public.lecture_document_revisions to service_role;
create or replace function public.lecture_version() returns trigger language plpgsql set search_path=public as $$ begin
 new.id:=old.id; new.owner_id:=old.owner_id; new.created_at:=old.created_at; new.version:=old.version+1; new.updated_at:=clock_timestamp();
 if tg_table_name='lecture_documents' then
  new.project_id:=old.project_id; new.kind:=old.kind;
  if new.body is distinct from old.body or new.title is distinct from old.title then new.status:='draft'; end if;
 end if;
 return new;
end $$;
create or replace function public.lecture_snapshot() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.lecture_document_revisions(document_id,owner_id,title,body,status,version) values(new.id,new.owner_id,new.title,new.body,new.status,new.version); return new;
end $$;
revoke all on function public.lecture_snapshot() from public,anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='lecture_project_version' and tgrelid='public.lecture_projects'::regclass) then
  create trigger lecture_project_version before update on public.lecture_projects for each row execute function public.lecture_version();
  create trigger lecture_document_version before update on public.lecture_documents for each row execute function public.lecture_version();
  create trigger lecture_document_snapshot after insert or update on public.lecture_documents for each row execute function public.lecture_snapshot();
 end if;
end $$;
create index if not exists lecture_owner_updated on public.lecture_projects(owner_id,updated_at desc);
create index if not exists lecture_docs_project on public.lecture_documents(owner_id,project_id,updated_at desc);
commit;
