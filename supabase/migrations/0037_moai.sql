-- Shared MoAI operations. Membership is assigned separately; no public access.
begin;
create table if not exists public.moai_members(user_id uuid primary key references public.profiles(id),role text not null check(role in ('reviewer','operator')));
create or replace function public.moai_role() returns text language sql stable security definer set search_path=public,pg_temp as $$select role from public.moai_members where user_id=auth.uid()$$;
revoke all on function public.moai_role() from public,anon;grant execute on function public.moai_role() to authenticated,service_role;
create table if not exists public.moai_templates(kind text primary key check(kind in ('plan','timetable','record','survey','result','consent')),title text not null,body text not null check(length(body)<=40000),version integer not null default 1,updated_at timestamptz not null default now());
create table if not exists public.moai_gatherings(
 id uuid primary key default gen_random_uuid(),title text not null check(length(btrim(title)) between 1 and 200),kind text not null check(kind in ('monthly','study')),
 period text not null default '' check(period='' or period~'^\d{4}-(0[1-9]|1[0-2])$'),theme text not null default '' check(length(theme)<=1000),
 capacity integer not null default 0 check(capacity between 0 and 10000),fee integer not null default 0 check(fee between 0 and 10000000),
 state text not null default 'draft' check(state in ('draft','review','changes','approved','running','completed','cancelled')),
 sessions jsonb not null default '[]' check(jsonb_typeof(sessions)='array' and jsonb_array_length(sessions)<=60 and octet_length(sessions::text)<=100000),
 checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=60 and octet_length(checklist::text)<=50000),
 plan text not null default '' check(length(plan)<=40000),timetable text not null default '' check(length(timetable)<=40000),record text not null default '' check(length(record)<=40000),survey text not null default '' check(length(survey)<=40000),result text not null default '' check(length(result)<=40000),
 consent text not null default '' check(length(consent)<=40000),session_notes jsonb not null default '{}' check(jsonb_typeof(session_notes)='object' and octet_length(session_notes::text)<=400000),
 archived boolean not null default false,version integer not null default 1,approved_by uuid references public.profiles(id),approved_version integer,reviewed_at timestamptz,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.moai_participants(
 id uuid primary key default gen_random_uuid(),gathering_id uuid not null references public.moai_gatherings(id),name text not null check(length(btrim(name)) between 1 and 120),contact text not null default '' check(length(contact)<=200),payer text not null default '' check(length(payer)<=120),
 role text not null default 'participant' check(role in ('participant','mentor')),photo_consent text not null default 'pending' check(photo_consent in ('pending','agreed','declined')),signature_checked boolean not null default false,
 expected_fee integer not null default 0 check(expected_fee between 0 and 10000000),paid_amount integer not null default 0 check(paid_amount between 0 and 10000000),
 status text not null default 'applied' check(status in ('applied','confirmed','waitlisted','cancelled')),memo text not null default '' check(length(memo)<=2000),attendance jsonb not null default '{}' check(jsonb_typeof(attendance)='object' and octet_length(attendance::text)<=15000),
 source_key text,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(gathering_id,source_key)
);
create table if not exists public.moai_activity(id uuid primary key default gen_random_uuid(),gathering_id uuid not null references public.moai_gatherings(id),actor_id uuid not null references public.profiles(id),actor_name text not null,action text not null,comment text not null default '',version integer,snapshot jsonb,created_at timestamptz not null default now());
create index if not exists moai_gatherings_updated on public.moai_gatherings(updated_at desc);
create index if not exists moai_participants_gathering on public.moai_participants(gathering_id,created_at);
create index if not exists moai_activity_gathering on public.moai_activity(gathering_id,created_at desc);
do $$declare t text;begin
 foreach t in array array['moai_members','moai_templates','moai_gatherings','moai_participants','moai_activity'] loop
  execute format('alter table public.%I enable row level security',t);
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='moai_member_read') then execute format('create policy moai_member_read on public.%I for select to authenticated using(public.moai_role() is not null)',t);end if;
  execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create or replace function public.moai_require_role(p_review boolean default false) returns text language plpgsql security definer set search_path=public,pg_temp as $$declare r text:=public.moai_role();begin
 if r is null or (p_review and r<>'reviewer') then raise exception '이 작업의 모아이 권한이 없습니다.';end if;return r;end $$;
create or replace function public.moai_log(p_id uuid,p_action text,p_comment text default '',p_snapshot boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$begin
 insert into public.moai_activity(gathering_id,actor_id,actor_name,action,comment,version,snapshot) select g.id,auth.uid(),p.name,p_action,left(p_comment,2000),g.version,case when p_snapshot then to_jsonb(g) else null end from public.moai_gatherings g cross join public.profiles p where g.id=p_id and p.id=auth.uid();end $$;
revoke all on function public.moai_log(uuid,text,text,boolean),public.moai_require_role(boolean) from public,anon,authenticated;
create or replace function public.moai_save_gathering(p_id uuid,p_version integer,p_values jsonb) returns public.moai_gatherings language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.moai_gatherings;old_g public.moai_gatherings;s jsonb;c jsonb;changed boolean;sid uuid;
begin
 perform public.moai_require_role();
 if p_id is not null then select * into old_g from public.moai_gatherings where id=p_id for update;if not found or old_g.version is distinct from p_version then raise exception '다른 창에서 변경됐어요. 최신 내용을 다시 열어 주세요.' using detail='stale';end if;g:=old_g;
 else g.id:=gen_random_uuid();g.state:='draft';g.version:=0;g.created_by:=auth.uid();g.created_at:=now();end if;
 g.title:=btrim(p_values->>'title');g.kind:=p_values->>'kind';g.period:=coalesce(p_values->>'period','');g.theme:=coalesce(p_values->>'theme','');g.capacity:=(p_values->>'capacity')::integer;g.fee:=(p_values->>'fee')::integer;
 g.sessions:=coalesce(p_values->'sessions','[]');g.checklist:=coalesce(p_values->'checklist','[]');g.archived:=coalesce((p_values->>'archived')::boolean,false);
 if jsonb_typeof(g.sessions)<>'array' or jsonb_array_length(g.sessions)>60 then raise exception '회차를 확인해 주세요.';end if;
 for s in select value from jsonb_array_elements(g.sessions) loop
  sid:=(s->>'id')::uuid;
  if sid is null or length(btrim(coalesce(s->>'title',''))) not between 1 and 120 or length(coalesce(s->>'location',''))>300 then raise exception '회차 정보를 확인해 주세요.';end if;
  if coalesce(s->>'date','')<>'' then perform (s->>'date')::date;if (s->>'date')!~'^\d{4}-\d{2}-\d{2}$' then raise exception '날짜를 확인해 주세요.';end if;end if;
  if coalesce(s->>'start','')<>'' or coalesce(s->>'end','')<>'' then
   if coalesce(s->>'start','')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(s->>'end','')!~'^([01]\d|2[0-3]):[0-5]\d$' or s->>'end'<=s->>'start' then raise exception '시작·종료 시간을 확인해 주세요.';end if;
  end if;
 end loop;
 if (select count(*) from jsonb_array_elements(g.sessions))<>(select count(distinct value->>'id') from jsonb_array_elements(g.sessions)) then raise exception '중복된 회차가 있습니다.';end if;
 if jsonb_typeof(g.checklist)<>'array' then raise exception '준비 항목을 확인해 주세요.';end if;
 for c in select value from jsonb_array_elements(g.checklist) loop if length(coalesce(c->>'title','')) not between 1 and 250 or jsonb_typeof(c->'done') is distinct from 'boolean' then raise exception '준비 항목을 확인해 주세요.';end if;end loop;
 if exists(select 1 from public.moai_participants p cross join lateral jsonb_object_keys(p.attendance) a(key) where p.gathering_id=g.id and not exists(select 1 from jsonb_array_elements(g.sessions) entry(value) where entry.value->>'id'=a.key)) then raise exception '출석 기록이 있는 회차는 지울 수 없어요.';end if;
 if g.capacity>0 and g.capacity<(select count(*) from public.moai_participants where gathering_id=g.id and status='confirmed' and role='participant') then raise exception '정원은 확정 참여자 수보다 작을 수 없어요.';end if;
 g.plan:=coalesce(p_values->>'plan','');g.timetable:=coalesce(p_values->>'timetable','');g.record:=coalesce(p_values->>'record','');g.survey:=coalesce(p_values->>'survey','');g.result:=coalesce(p_values->>'result','');g.consent:=coalesce(p_values->>'consent','');g.session_notes:=coalesce(p_values->'session_notes','{}');
 if jsonb_typeof(g.session_notes)<>'object' then raise exception '회차 메모를 확인해 주세요.';end if;
 for c in select jsonb_build_object('id',key,'note',value) from jsonb_each_text(g.session_notes) loop if length(c->>'note')>6000 or not exists(select 1 from jsonb_array_elements(g.sessions) entry(value) where entry.value->>'id'=c->>'id') then raise exception '회차 메모를 확인해 주세요.';end if;end loop;
 changed:=p_id is not null and row(g.title,g.kind,g.period,g.theme,g.capacity,g.fee,g.sessions,g.plan,g.timetable,g.consent) is distinct from row(old_g.title,old_g.kind,old_g.period,old_g.theme,old_g.capacity,old_g.fee,old_g.sessions,old_g.plan,old_g.timetable,old_g.consent);
 if changed and old_g.state in ('review','approved','running','completed') then g.state:='draft';g.approved_by:=null;g.approved_version:=null;g.reviewed_at:=null;end if;
 g.version:=g.version+1;g.updated_at:=now();
 if p_id is null then insert into public.moai_gatherings select g.*;
 else update public.moai_gatherings set title=g.title,kind=g.kind,period=g.period,theme=g.theme,capacity=g.capacity,fee=g.fee,sessions=g.sessions,checklist=g.checklist,archived=g.archived,plan=g.plan,timetable=g.timetable,record=g.record,survey=g.survey,result=g.result,consent=g.consent,session_notes=g.session_notes,state=g.state,approved_by=g.approved_by,approved_version=g.approved_version,reviewed_at=g.reviewed_at,version=g.version,updated_at=g.updated_at where id=g.id;end if;
 perform public.moai_log(g.id,case when p_id is null then 'created' when changed and g.state='draft' and old_g.state<>'draft' then 'approval_reset' else 'saved' end,'',true);return g;
end $$;
create or replace function public.moai_transition(p_id uuid,p_version integer,p_action text,p_comment text default '') returns public.moai_gatherings language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.moai_gatherings;next_state text;begin
 perform public.moai_require_role(p_action in ('approve','changes'));
 select * into g from public.moai_gatherings where id=p_id for update;
 if not found or g.version is distinct from p_version then raise exception '다른 창에서 변경됐어요. 최신 내용을 다시 열어 주세요.' using detail='stale';end if;
 if g.archived then raise exception '보관함에서 복원한 뒤 진행해 주세요.';end if;
 if length(p_comment)>2000 then raise exception '의견은 2,000자까지 입력해 주세요.';end if;
 case p_action
 when 'request' then
  if g.state not in ('draft','changes') or btrim(g.plan)='' or btrim(g.timetable)='' then raise exception '기획안과 타임테이블을 작성한 뒤 검토를 요청해 주세요.';end if;next_state:='review';
 when 'approve' then if g.state<>'review' then raise exception '검토 요청된 기획만 승인할 수 있어요.';end if;next_state:='approved';g.approved_by:=auth.uid();g.approved_version:=g.version;g.reviewed_at:=now();
 when 'changes' then if g.state<>'review' or btrim(p_comment)='' then raise exception '검토 요청된 기획에 수정 의견을 남겨 주세요.';end if;next_state:='changes';
 when 'start' then if g.state<>'approved' then raise exception '승인 후 운영을 시작할 수 있어요.';end if;next_state:='running';
 when 'complete' then if g.state not in ('approved','running') or btrim(g.result)='' then raise exception '승인된 모임의 결과를 정리한 뒤 완료해 주세요.';end if;next_state:='completed';
 when 'cancel' then if g.state in ('completed','cancelled') then raise exception '진행 상태를 확인해 주세요.';end if;next_state:='cancelled';
 when 'reopen' then if g.state<>'cancelled' then raise exception '취소된 모임만 다시 열 수 있어요.';end if;next_state:='draft';g.approved_by:=null;g.approved_version:=null;g.reviewed_at:=null;
 else raise exception '진행할 작업을 확인해 주세요.';
 end case;
 update public.moai_gatherings set state=next_state,approved_by=g.approved_by,approved_version=g.approved_version,reviewed_at=g.reviewed_at,version=version+1,updated_at=now() where id=g.id returning * into g;
 perform public.moai_log(g.id,p_action,p_comment,true);return g;
end $$;
create or replace function public.moai_save_participant(p_gathering uuid,p_id uuid,p_version integer,p_values jsonb) returns public.moai_participants language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.moai_gatherings;p public.moai_participants;a record;begin
 perform public.moai_require_role();select * into g from public.moai_gatherings where id=p_gathering for update;
 if not found or g.archived or g.state='cancelled' then raise exception '모임 상태를 확인해 주세요.';end if;
 if p_id is not null then select * into p from public.moai_participants where id=p_id and gathering_id=g.id for update;if not found or p.version is distinct from p_version then raise exception '다른 창에서 명단이 변경됐어요. 최신 내용을 다시 열어 주세요.' using detail='stale';end if;
 else if (select count(*) from public.moai_participants where gathering_id=g.id)>=2000 then raise exception '한 모임에 2,000명까지 등록할 수 있어요.';end if;p.id:=gen_random_uuid();p.gathering_id:=g.id;p.version:=0;p.created_at:=now();end if;
 p.name:=btrim(p_values->>'name');p.contact:=coalesce(p_values->>'contact','');p.payer:=coalesce(p_values->>'payer','');p.role:=coalesce(p_values->>'role','participant');p.photo_consent:=coalesce(p_values->>'photo_consent','pending');p.signature_checked:=coalesce((p_values->>'signature_checked')::boolean,false);
 p.expected_fee:=(p_values->>'expected_fee')::integer;p.paid_amount:=(p_values->>'paid_amount')::integer;p.status:=p_values->>'status';p.memo:=coalesce(p_values->>'memo','');p.attendance:=coalesce(p_values->'attendance','{}');
 if p.status='confirmed' and p.paid_amount<p.expected_fee then raise exception '참가비 입금 확인 후 확정해 주세요.';end if;
 if p.status='confirmed' and p.role='participant' and g.capacity>0 and (select count(*) from public.moai_participants where gathering_id=g.id and status='confirmed' and role='participant' and id<>p.id)>=g.capacity then raise exception '정원이 찼어요. 대기자로 등록해 주세요.';end if;
 if jsonb_typeof(p.attendance)<>'object' then raise exception '출석 기록을 확인해 주세요.';end if;
 for a in select * from jsonb_each_text(p.attendance) loop
  if a.value not in ('present','absent','no_show') or not exists(select 1 from jsonb_array_elements(g.sessions) entry(value) where entry.value->>'id'=a.key) then raise exception '해당 모임의 회차와 출석 상태를 확인해 주세요.';end if;
 end loop;
 p.version:=p.version+1;p.updated_at:=now();
 if p_id is null then insert into public.moai_participants select p.*;else update public.moai_participants set name=p.name,contact=p.contact,payer=p.payer,role=p.role,photo_consent=p.photo_consent,signature_checked=p.signature_checked,expected_fee=p.expected_fee,paid_amount=p.paid_amount,status=p.status,memo=p.memo,attendance=p.attendance,version=p.version,updated_at=p.updated_at where id=p.id;end if;
 perform public.moai_log(g.id,'participant',p.name||' · 명단/입금/출석 기록 저장');return p;
end $$;
create or replace function public.moai_import_participants(p_gathering uuid,p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.moai_gatherings;r jsonb;n integer:=0;total integer;k text;begin
 perform public.moai_require_role();select * into g from public.moai_gatherings where id=p_gathering for update;
 if not found or g.archived or g.state='cancelled' then raise exception '모임 상태를 확인해 주세요.';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception '한 번에 500명까지 가져올 수 있어요.';end if;
 select count(*) into total from public.moai_participants where gathering_id=g.id;
 for r in select value from jsonb_array_elements(p_rows) loop
  if total+n>=2000 then raise exception '한 모임에 2,000명까지 등록할 수 있어요.';end if;
  k:=md5(lower(btrim(coalesce(r->>'name','')))||'|'||regexp_replace(coalesce(r->>'contact',''),'\s','','g')||'|'||btrim(coalesce(r->>'payer','')));
  if exists(select 1 from public.moai_participants where gathering_id=g.id and lower(btrim(name))=lower(btrim(r->>'name')) and regexp_replace(contact,'\s','','g')=regexp_replace(coalesce(r->>'contact',''),'\s','','g') and payer=btrim(coalesce(r->>'payer',''))) then continue;end if;
  insert into public.moai_participants(gathering_id,name,contact,payer,memo,expected_fee,source_key) values(g.id,btrim(r->>'name'),btrim(coalesce(r->>'contact','')),btrim(coalesce(r->>'payer','')),coalesce(r->>'memo',''),g.fee,k) on conflict(gathering_id,source_key) do nothing;
  if found then n:=n+1;end if;
 end loop;
 perform public.moai_log(g.id,'import',n||'명 가져옴 · 중복 '||(jsonb_array_length(p_rows)-n)||'명 건너뜀');return jsonb_build_object('imported',n,'skipped',jsonb_array_length(p_rows)-n);
end $$;
create or replace function public.moai_save_template(p_kind text,p_version integer,p_body text) returns public.moai_templates language plpgsql security definer set search_path=public,pg_temp as $$declare t public.moai_templates;begin
 perform public.moai_require_role();select * into t from public.moai_templates where kind=p_kind for update;
 if not found and p_version=0 then insert into public.moai_templates(kind,title,body) values(p_kind,case p_kind when 'plan' then '기획안' when 'timetable' then '타임테이블' when 'record' then '모임 기록지' when 'survey' then '참가자 설문지' when 'result' then '결과 정리' when 'consent' then '촬영 동의 안내' end,p_body) returning * into t;return t;end if;
 if not found or t.version is distinct from p_version then raise exception '양식이 변경됐어요. 최신 내용을 다시 열어 주세요.' using detail='stale';end if;
 update public.moai_templates set body=p_body,version=version+1,updated_at=now() where kind=p_kind returning * into t;return t;end $$;
revoke all on function public.moai_save_gathering(uuid,integer,jsonb),public.moai_transition(uuid,integer,text,text),public.moai_save_participant(uuid,uuid,integer,jsonb),public.moai_import_participants(uuid,jsonb),public.moai_save_template(text,integer,text) from public,anon;
grant execute on function public.moai_save_gathering(uuid,integer,jsonb),public.moai_transition(uuid,integer,text,text),public.moai_save_participant(uuid,uuid,integer,jsonb),public.moai_import_participants(uuid,jsonb),public.moai_save_template(text,integer,text) to authenticated;
commit;
