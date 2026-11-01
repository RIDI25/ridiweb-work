-- Explicit MoAI-only access with a narrowly scoped, read-only shared calendar.
-- Existing users without an access row retain their previous access until assigned.
begin;
create table if not exists public.ridiweb_access(user_id uuid primary key references public.profiles(id),scope text not null check(scope in ('full','moai')),calendar_owner_id uuid references public.profiles(id));
alter table public.ridiweb_access enable row level security;
do $$begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='ridiweb_access' and policyname='own_access') then create policy own_access on public.ridiweb_access for select to authenticated using(user_id=auth.uid());end if;end $$;
revoke all on public.ridiweb_access from anon,authenticated;grant select on public.ridiweb_access to authenticated;grant all on public.ridiweb_access to service_role;
create or replace function public.has_optify_access() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select public.is_team_member() and not exists(select 1 from public.ridiweb_access where user_id=auth.uid() and scope='moai')$$;
revoke all on function public.has_optify_access() from public,anon;grant execute on function public.has_optify_access() to authenticated,service_role;
do $$declare t record;op text;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname not like 'moai_%' and c.relname not in ('profiles','ridiweb_access','assistant_conversations','assistant_messages','assistant_turns','assistant_archives') loop
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=t.relname and policyname='ridiweb_scope') then execute format('create policy ridiweb_scope on public.%I as restrictive for all to authenticated using(public.has_optify_access()) with check(public.has_optify_access())',t.relname);end if;
 end loop;
 foreach op in array array['insert','update','delete'] loop
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='ridiweb_scope_'||op) then execute 'create policy ridiweb_scope_'||op||' on public.profiles as restrictive for '||op||' to authenticated '||case when op='insert' then 'with check(public.has_optify_access())' when op='delete' then 'using(public.has_optify_access())' else 'using(public.has_optify_access()) with check(public.has_optify_access())' end;end if;
 end loop;
 if to_regclass('storage.objects') is not null then
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='ridiweb_optify_storage') then
   create policy ridiweb_optify_storage on storage.objects as restrictive for all to authenticated using(public.has_optify_access()) with check(public.has_optify_access());
  else alter policy ridiweb_optify_storage on storage.objects using(public.has_optify_access()) with check(public.has_optify_access());end if;
 end if;
end $$;
create or replace function public.moai_shared_schedule() returns table(key text,date date,"time" text,label text,sub text) language plpgsql stable security definer set search_path=public,pg_temp as $$declare owner_id uuid;begin
 perform public.moai_require_role();select calendar_owner_id into owner_id from public.ridiweb_access where user_id=auth.uid();
 if owner_id is null then return;end if;
 return query select 'shared-'||e.id::text,e.event_date,to_char(e.event_time,'HH24:MI'),e.title,'옵티파이 · 공유 일정'::text from public.events e where e.assignee_id=owner_id or (e.assignee_id is null and e.created_by=owner_id) order by e.event_date;
end $$;
revoke all on function public.moai_shared_schedule() from public,anon;grant execute on function public.moai_shared_schedule() to authenticated;

create or replace function public.resolve_assistant_action(request_id uuid, decision text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.assistant_action_requests%rowtype;
  p jsonb;
  t public.tasks%rowtype;
  inv public.tax_invoices%rowtype;
  paid bigint;
  role_name text;
  rid uuid;
  result_value jsonb;
begin
  if not public.has_optify_access() then raise exception '옵티파이 변경 권한이 없습니다.';end if;
  select role into role_name from public.profiles where id = auth.uid();
  if auth.uid() is null or role_name is null then raise exception '팀원 로그인이 필요합니다.'; end if;
  if decision not in ('confirm','cancel') or decision is null then raise exception '잘못된 확인 요청입니다.'; end if;
  select * into a from public.assistant_action_requests where id = request_id and user_id = auth.uid() for update;
  if not found then raise exception '확인할 초안을 찾지 못했습니다.'; end if;
  -- Replay returns the original terminal result; it can never execute again.
  if a.status <> 'pending' then return to_jsonb(a) - 'payload' - 'user_id'; end if;
  if a.expires_at <= now() then
    update public.assistant_action_requests set status = 'expired', resolved_at = now(),
      result = jsonb_build_object('ok', false, 'message', '초안 확인 기한이 지났습니다. 다시 요청해 주세요.') where id = a.id returning * into a;
    return to_jsonb(a) - 'payload' - 'user_id';
  end if;
  if decision = 'cancel' then
    update public.assistant_action_requests set status = 'cancelled', resolved_at = now(),
      result = jsonb_build_object('ok', false, 'message', '초안을 취소했습니다. 업무 기록은 변경하지 않았습니다.') where id = a.id returning * into a;
    return to_jsonb(a) - 'payload' - 'user_id';
  end if;
  p := a.payload; rid := a.id;
  -- Subtransaction: any write error rolls back ALL business mutations before marking failed.
  begin
    if a.tool_name in ('add_tax_invoice','add_invoice_payment','add_lead') and role_name <> 'owner' then
      raise exception '이 기록은 owner만 등록할 수 있습니다.';
    end if;
    if a.tool_name in ('update_task_status','set_task_waiting') then
      select * into t from public.tasks where id = (p->>'task_id')::uuid for update;
      if not found or t.updated_at is distinct from (p->>'expected_updated_at')::timestamptz then
        raise exception '업무가 변경되거나 삭제되었습니다. 최신 내용으로 초안을 다시 만들어 주세요.';
      end if;
      rid := t.id;
    end if;
    case a.tool_name
      when 'create_task' then
        insert into public.tasks(id, title, client_id, assignee_id, due_date, status, task_type, priority, memo, created_by) values(a.id, p->>'title', (p->>'client_id')::uuid, (p->>'assignee_id')::uuid, (p->>'due_date')::date, p->>'status', p->>'task_type', p->>'priority', p->>'memo', auth.uid());
      when 'create_event' then
        insert into public.events(id, title, event_date, event_time, event_type, client_id, assignee_id, memo, created_by) values(a.id, p->>'title', (p->>'event_date')::date, (p->>'event_time')::time, p->>'event_type', (p->>'client_id')::uuid, (p->>'assignee_id')::uuid, p->>'memo', auth.uid());
      when 'add_tax_invoice' then
        insert into public.tax_invoices(id, counterparty, end_client_name, description, deal_channel, memo, issue_date, supply_amount, vat_amount, total_amount, created_by) values(a.id, p->>'counterparty', p->>'end_client_name', p->>'description', p->>'deal_channel', p->>'memo', (p->>'issue_date')::date, (p->>'supply_amount')::bigint, (p->>'vat_amount')::bigint, (p->>'total_amount')::bigint, auth.uid());
      when 'add_lead' then
        insert into public.leads(id, company_name, contact_name, phone, email, industry, region, source, deal_channel, partner_name, memo, next_followup, created_by) values(a.id, p->>'company_name', p->>'contact_name', p->>'phone', p->>'email', p->>'industry', p->>'region', p->>'source', p->>'deal_channel', p->>'partner_name', p->>'memo', (p->>'next_followup')::date, auth.uid());
      when 'add_ledger_entry' then
        insert into public.ledger_entries(id, entry_date, amount, entry_type, payment_method, counterparty, description, category, memo, created_by) values(a.id, (p->>'entry_date')::date, (p->>'amount')::bigint, p->>'entry_type', p->>'payment_method', p->>'counterparty', p->>'description', p->>'category', p->>'memo', auth.uid());
      when 'update_task_status' then
        if p->>'status' not in ('todo','in_progress','review','done') or p->>'status' is null then raise exception '업무 상태를 확인해 주세요.'; end if;
        update public.tasks set status = p->>'status' where id = t.id;
      when 'set_task_waiting' then
        if t.status = 'done' then raise exception '완료된 업무에는 대기를 등록할 수 없습니다.'; end if;
        update public.tasks set waiting_on = p->>'waiting_on', waiting_reason = p->>'waiting_reason', followup_date = (p->>'followup_date')::date where id = t.id;
      when 'add_invoice_payment' then
        select * into inv from public.tax_invoices where id = (p->>'invoice_id')::uuid for update;
        if not found or to_jsonb(inv) is distinct from p->'expected_invoice' then
          raise exception '인보이스가 변경되거나 삭제되었습니다. 입금 초안을 다시 만들어 주세요.';
        end if;
        select coalesce(sum(amount),0) into paid from public.invoice_payments where invoice_id = inv.id;
        if inv.status = 'cancelled' or paid is distinct from (p->>'expected_paid')::bigint then
          raise exception '입금 기록이 변경되었습니다. 입금 초안을 다시 만들어 주세요.';
        end if;
        if (p->>'amount')::bigint <= 0 or (p->>'amount')::bigint > inv.total_amount - paid then
          raise exception '입금액과 남은 미수금을 확인해 주세요.';
        end if;
        insert into public.invoice_payments(id, invoice_id, paid_date, amount, kind, memo)
          values(a.id, inv.id, (p->>'paid_date')::date, (p->>'amount')::bigint, p->>'kind', p->>'memo');
        if paid + (p->>'amount')::bigint = inv.total_amount then
          update public.tax_invoices set status = 'paid', paid_at = (p->>'paid_date')::date, updated_at = clock_timestamp() where id = inv.id;
        end if;
      else raise exception '지원하지 않는 실행 요청입니다.';
    end case;
    result_value := jsonb_build_object('ok', true, 'message', (a.display->>'title') || ' 내용을 반영했습니다.', 'record_id', rid);
    update public.assistant_action_requests set status = 'succeeded', resolved_at = now(), result = result_value where id = a.id returning * into a;
  exception when others then
    result_value := jsonb_build_object('ok', false, 'message', case when sqlstate = 'P0001' then sqlerrm else '기록을 반영하지 못했습니다. 대상과 입력값을 확인해 새 초안을 만들어 주세요.' end);
    update public.assistant_action_requests set status = 'failed', resolved_at = now(), result = result_value where id = a.id returning * into a;
  end;
  return to_jsonb(a) - 'payload' - 'user_id';
end $$;
commit;
