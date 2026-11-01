-- Lecture assistant writes share the existing own-draft confirmation transaction.
-- Security-definer writes explicitly enforce auth.uid() ownership and version locks.
begin;
create or replace function public.assistant_validate_lecture_project(v jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare s jsonb; x text;
begin
 if jsonb_typeof(v->'sessions') is distinct from 'array' or jsonb_array_length(v->'sessions')>80 or jsonb_typeof(v->'checklist') is distinct from 'array' or jsonb_array_length(v->'checklist')>80 then raise exception '일정·준비 항목을 확인해 주세요.';end if;
 if exists(select 1 from jsonb_array_elements(v->'sessions') e group by e->>'id' having count(*)>1) or exists(select 1 from jsonb_array_elements(v->'checklist') e group by e->>'id' having count(*)>1) then raise exception '중복된 일정·준비 항목이 있어요.';end if;
 for s in select value from jsonb_array_elements(v->'sessions') loop
  if jsonb_typeof(s) is distinct from 'object' or coalesce(s->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(length(btrim(s->>'title')),0) not between 1 and 150 or coalesce(s->>'kind','') not in ('lecture','prep','travel') or jsonb_typeof(s->'confirmed') is distinct from 'boolean' or coalesce(length(s->>'location'),301)>300 then raise exception '일정 정보를 확인해 주세요.';end if;
  x:=s->>'date';
  if x is null or (x<>'' and (x !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(x::date,'YYYY-MM-DD')<>x)) or ((s->>'confirmed')::boolean and x='') then raise exception '일정 날짜를 확인해 주세요.';end if;
  if s->>'start' is null or s->>'end' is null or ((s->>'start'='')<>(s->>'end'='')) or (s->>'start'<>'' and (s->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or s->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or s->>'end'<=s->>'start')) then raise exception '일정 시작·종료 시간을 확인해 주세요.';end if;
 end loop;
 for s in select value from jsonb_array_elements(v->'checklist') loop
  if jsonb_typeof(s) is distinct from 'object' or coalesce(length(btrim(s->>'id')),0) not between 1 and 80 or coalesce(length(btrim(s->>'title')),0) not between 1 and 250 or jsonb_typeof(s->'done') is distinct from 'boolean' then raise exception '준비 항목을 확인해 주세요.';end if;
 end loop;
end $$;
revoke all on function public.assistant_validate_lecture_project(jsonb) from public,anon,authenticated;
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
  gathering public.moai_gatherings;
  lecture public.lecture_projects;
  lecture_values public.lecture_projects;
  document public.lecture_documents;
  d jsonb;
  v jsonb;
  parent_id uuid;
begin
  select role into role_name from public.profiles where id = auth.uid();
  if auth.uid() is null or role_name is null then raise exception '팀원 로그인이 필요합니다.'; end if;
  if decision not in ('confirm','cancel') or decision is null then raise exception '잘못된 확인 요청입니다.'; end if;
  select * into a from public.assistant_action_requests where id = request_id and user_id = auth.uid() for update;
  if not found then raise exception '확인할 초안을 찾지 못했습니다.'; end if;
  if a.tool_name in ('create_moai_gathering','upsert_moai_sessions') then
    perform public.moai_require_role();
  elsif not public.has_optify_access() then
    raise exception '옵티파이 변경 권한이 없습니다.';
  end if;
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
      when 'create_lecture_project' then
        v := p->'values';
        perform public.assistant_validate_lecture_project(v);
        perform pg_advisory_xact_lock(hashtextextended('assistant-lecture:'||auth.uid()::text||':'||lower(btrim(v->>'title'))||':'||lower(btrim(v->>'organization')),0));
        if exists(select 1 from public.lecture_projects where owner_id=auth.uid() and not archived and lower(btrim(title))=lower(btrim(v->>'title')) and lower(btrim(organization))=lower(btrim(v->>'organization'))) then
          raise exception '같은 이름·기관의 강의가 이미 있어요. 기존 강의를 조회해 주세요.';
        end if;
        lecture_values := jsonb_populate_record(null::public.lecture_projects,v);
        insert into public.lecture_projects(id,owner_id,title,origin,stage,organization,contact,audience,brief,fee,next_action,next_action_date,sessions,checklist,history_verified,archived)
          values(a.id,auth.uid(),lecture_values.title,lecture_values.origin,lecture_values.stage,lecture_values.organization,lecture_values.contact,lecture_values.audience,lecture_values.brief,lecture_values.fee,lecture_values.next_action,lecture_values.next_action_date,lecture_values.sessions,lecture_values.checklist,lecture_values.history_verified,lecture_values.archived);
        if jsonb_typeof(p->'documents') is distinct from 'array' or jsonb_array_length(p->'documents')>5 then raise exception '함께 저장할 문서를 확인해 주세요.';end if;
        for d in select value from jsonb_array_elements(p->'documents') loop
          if d->>'status' is distinct from 'draft' or d->>'archived' is distinct from 'false' then raise exception '새 문서는 작성 중으로 저장해 주세요.';end if;
          insert into public.lecture_documents(owner_id,project_id,kind,title,body,status) values(auth.uid(),a.id,d->>'kind',d->>'title',d->>'body','draft');
        end loop;
      when 'update_lecture_project' then
        select * into lecture from public.lecture_projects where id=(p->>'project_id')::uuid and owner_id=auth.uid() for update;
        if not found or lecture.version is distinct from (p->>'expected_version')::integer then raise exception '강의가 변경되었거나 접근할 수 없어요. 최신 내용을 조회해 다시 요청해 주세요.';end if;
        v := p->'values'; perform public.assistant_validate_lecture_project(v);
        lecture_values := jsonb_populate_record(null::public.lecture_projects,v);
        update public.lecture_projects set title=lecture_values.title,origin=lecture_values.origin,stage=lecture_values.stage,organization=lecture_values.organization,contact=lecture_values.contact,audience=lecture_values.audience,brief=lecture_values.brief,fee=lecture_values.fee,next_action=lecture_values.next_action,next_action_date=lecture_values.next_action_date,sessions=lecture_values.sessions,checklist=lecture_values.checklist,history_verified=lecture_values.history_verified,archived=lecture_values.archived where id=lecture.id and owner_id=auth.uid();
        rid := lecture.id;
      when 'save_lecture_document' then
        v := p->'values';
        if p->>'document_id' is not null then
          select * into document from public.lecture_documents where id=(p->>'document_id')::uuid and owner_id=auth.uid() for update;
          if not found or document.version is distinct from (p->>'expected_version')::integer then raise exception '문서가 변경되었거나 접근할 수 없어요. 최신 내용을 조회해 다시 요청해 주세요.';end if;
          if document.project_id is distinct from (p->>'project_id')::uuid or document.kind is distinct from v->>'kind' then raise exception '문서 종류·소속 변경은 새 문서로 복사해 주세요.';end if;
          if v->>'status'='final' and (v->>'body' is distinct from document.body or v->>'title' is distinct from document.title or length(btrim(v->>'body'))=0) then raise exception '내용을 저장하고 검토한 뒤 확정해 주세요.';end if;
          update public.lecture_documents set title=v->>'title',body=v->>'body',status=v->>'status',archived=(v->>'archived')::boolean where id=document.id and owner_id=auth.uid() returning * into document;
        else
          parent_id := (p->>'project_id')::uuid;
          if parent_id is not null then
            select * into lecture from public.lecture_projects where id=parent_id and owner_id=auth.uid() for update;
            if not found or lecture.archived then raise exception '문서를 추가할 내 강의를 먼저 조회·복원해 주세요.';end if;
          end if;
          if v->>'status' is distinct from 'draft' then raise exception '새 문서는 작성 중으로 저장해 주세요.';end if;
          perform pg_advisory_xact_lock(hashtextextended('assistant-lecture-doc:'||auth.uid()::text||':'||coalesce(parent_id::text,'library')||':'||(v->>'kind')||':'||lower(btrim(v->>'title')),0));
          if exists(select 1 from public.lecture_documents where owner_id=auth.uid() and project_id is not distinct from parent_id and not archived and kind=v->>'kind' and lower(btrim(title))=lower(btrim(v->>'title'))) then raise exception '같은 제목의 문서가 있어요. 조회 후 기존 문서를 수정해 주세요.';end if;
          insert into public.lecture_documents(id,owner_id,project_id,kind,title,body,status,archived) values(a.id,auth.uid(),parent_id,v->>'kind',v->>'title',v->>'body','draft',(v->>'archived')::boolean) returning * into document;
        end if;
        rid := document.id;
      when 'create_moai_gathering' then
        -- Serialize same-name drafts, including confirmations from different operators.
        perform pg_advisory_xact_lock(hashtextextended('assistant-moai:' || lower(btrim(p->'values'->>'title')) || ':' || (p->'values'->>'kind') || ':' || coalesce(p->'values'->>'period',''),0));
        if exists(select 1 from public.moai_gatherings where not archived and lower(btrim(title))=lower(btrim(p->'values'->>'title')) and kind=p->'values'->>'kind' and period=coalesce(p->'values'->>'period','')) then
          raise exception '같은 이름·운영 월의 모임이 이미 있어요. 기존 모임을 조회해 주세요.';
        end if;
        gathering := public.moai_save_gathering(null,null,p->'values');
        rid := gathering.id;
      when 'upsert_moai_sessions' then
        select * into gathering from public.moai_gatherings where id=(p->>'gathering_id')::uuid for update;
        if not found or gathering.version is distinct from (p->>'expected_version')::integer then
          raise exception '모임이 변경되거나 삭제됐어요. 최신 내용을 조회해 초안을 다시 만들어 주세요.';
        end if;
        if gathering.archived or gathering.state='cancelled' then raise exception '보관·취소된 모임은 복원한 뒤 변경해 주세요.';end if;
        if jsonb_typeof(p->'sessions') is distinct from 'array' then raise exception '회차를 확인해 주세요.';end if;
        if exists(select 1 from jsonb_array_elements(gathering.sessions) old_session where not exists(select 1 from jsonb_array_elements(p->'sessions') new_session where new_session->>'id'=old_session->>'id')) then
          raise exception '기존 회차는 삭제할 수 없어요. 최신 회차를 다시 조회해 주세요.';
        end if;
        gathering := public.moai_save_gathering(gathering.id,gathering.version,to_jsonb(gathering)||jsonb_build_object('sessions',p->'sessions'));
        rid := gathering.id;
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
    if a.tool_name in ('create_moai_gathering','upsert_moai_sessions') then
      result_value := result_value || jsonb_build_object('href','/moai/'||rid::text,'message',case when a.tool_name='create_moai_gathering' then '모임과 회차를 저장했습니다. 통합 캘린더에도 가안으로 표시됩니다. 기획 최종 승인은 별도입니다.' else '회차 일정을 저장하고 통합 캘린더에 반영했습니다. 기획 상태를 함께 확인해 주세요.' end);
    end if;
    if a.tool_name in ('create_lecture_project','update_lecture_project') then
      result_value := result_value || jsonb_build_object('href','/lectures/'||rid::text,'message','강의 내용을 저장했습니다. 날짜가 있는 일정은 통합 캘린더에 반영되며 보관·취소된 강의는 제외됩니다.');
    elsif a.tool_name='save_lecture_document' then
      result_value := result_value || jsonb_build_object('href','/lectures/'||coalesce(document.project_id::text,case when document.kind='profile' then 'profile' else 'library' end)||case when document.archived then '' else '?document='||rid::text end,'message',case when document.archived then '문서를 보관했습니다. 비서에게 보관 문서 조회·복원을 요청할 수 있습니다.' when document.status='final' then '검토한 문서를 확정본으로 저장했습니다.' else '문서를 작성 중으로 저장했습니다. 기존 저장 이력은 유지됩니다.' end);
      if not document.archived then result_value := result_value || jsonb_build_object('document_id',rid);end if;
    end if;
    update public.assistant_action_requests set status = 'succeeded', resolved_at = now(), result = result_value where id = a.id returning * into a;
  exception when others then
    result_value := jsonb_build_object('ok', false, 'message', case when sqlstate = 'P0001' then sqlerrm else '기록을 반영하지 못했습니다. 대상과 입력값을 확인해 새 초안을 만들어 주세요.' end);
    update public.assistant_action_requests set status = 'failed', resolved_at = now(), result = result_value where id = a.id returning * into a;
  end;
  return to_jsonb(a) - 'payload' - 'user_id';
end $$;
commit;
