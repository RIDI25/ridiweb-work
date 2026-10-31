-- Assistant confirmation and task waiting history. Apply after 0032.
-- Re-runnable. No customer data is seeded. Business writes occur only in the authenticated RPC.
begin;
alter table public.tasks add column if not exists waiting_on text not null default 'none';
alter table public.tasks add column if not exists waiting_reason text;
alter table public.tasks add column if not exists waiting_since timestamptz;
alter table public.tasks add column if not exists followup_date date;

create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists task_activity_task_date on public.task_activity(task_id, created_at desc);
alter table public.task_activity enable row level security;
revoke all on public.task_activity from public, anon, authenticated;
grant select on public.task_activity to authenticated;
drop policy if exists task_activity_read on public.task_activity;
create policy task_activity_read on public.task_activity for select to authenticated using (public.is_team_member());

create or replace function public.record_task_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.waiting_on not in ('none', 'client', 'vendor', 'internal') then
    raise exception '대기 구분을 확인해 주세요.';
  end if;
  if new.status = 'done' then new.waiting_on := 'none'; end if;
  if new.waiting_on = 'none' then
    new.waiting_reason := null; new.waiting_since := null; new.followup_date := null;
  else
    new.waiting_reason := nullif(btrim(new.waiting_reason), '');
    if new.waiting_reason is null or length(new.waiting_reason) > 2000 then
      raise exception '대기 사유를 1~2000자로 입력해 주세요.';
    end if;
    if tg_op = 'INSERT' or old.waiting_on is distinct from new.waiting_on or old.waiting_reason is distinct from new.waiting_reason then
      new.waiting_since := clock_timestamp();
    else new.waiting_since := old.waiting_since; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create or replace function public.append_task_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare b jsonb; a jsonb;
begin
  a := to_jsonb(new) - array['updated_at', 'created_at', 'waiting_since'];
  if tg_op = 'UPDATE' then b := to_jsonb(old) - array['updated_at', 'created_at', 'waiting_since']; end if;
  if a is distinct from b then
    insert into public.task_activity(task_id, actor_id, before_state, after_state)
      values(new.id, auth.uid(), b, a);
  end if;
  return new;
end $$;
drop trigger if exists task_waiting_normalize on public.tasks;
create trigger task_waiting_normalize before insert or update on public.tasks for each row execute function public.record_task_activity();
drop trigger if exists task_activity_append on public.tasks;
create trigger task_activity_append after insert or update on public.tasks for each row execute function public.append_task_activity();

create table if not exists public.assistant_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool_name text not null,
  payload jsonb not null,
  display jsonb not null,
  status text not null default 'pending' check(status in ('pending','succeeded','failed','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  resolved_at timestamptz,
  result jsonb
);
create index if not exists assistant_actions_user_date on public.assistant_action_requests(user_id, created_at desc);
alter table public.assistant_action_requests enable row level security;
revoke all on public.assistant_action_requests from public, anon, authenticated;
grant select on public.assistant_action_requests to authenticated;
grant all on public.assistant_action_requests to service_role;
drop policy if exists assistant_actions_read on public.assistant_action_requests;
create policy assistant_actions_read on public.assistant_action_requests for select to authenticated
  using(user_id = auth.uid() and public.is_team_member());

-- All payment writers lock their parent invoice, including existing manual screens.
-- This makes payment previews stale after any insert/update/delete, and serializes totals.
create or replace function public.touch_payment_invoice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.tax_invoices set updated_at = clock_timestamp() where id = new.invoice_id;
  elsif tg_op = 'DELETE' then
    update public.tax_invoices set updated_at = clock_timestamp() where id = old.invoice_id;
  else
    perform id from public.tax_invoices where id in (old.invoice_id, new.invoice_id) order by id for update;
    update public.tax_invoices set updated_at = clock_timestamp() where id in (old.invoice_id, new.invoice_id);
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists payment_invoice_version on public.invoice_payments;
create trigger payment_invoice_version before insert or update or delete on public.invoice_payments for each row execute function public.touch_payment_invoice();

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
revoke all on function public.resolve_assistant_action(uuid,text) from public, anon;
grant execute on function public.resolve_assistant_action(uuid,text) to authenticated;
revoke all on function public.record_task_activity() from public, anon, authenticated;
revoke all on function public.append_task_activity() from public, anon, authenticated;
revoke all on function public.touch_payment_invoice() from public, anon, authenticated;
commit;
