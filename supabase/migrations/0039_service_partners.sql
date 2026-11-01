-- Collaboration belongs to a contract/service, never to the whole client.
-- Existing records remain unclassified. No financial records or permissions change.
begin;
create unique index if not exists clients_id_kind_unique on public.clients(id, kind);
alter table public.client_services
  add column if not exists deal_channel text,
  add column if not exists partner_id uuid,
  add column if not exists partner_kind text generated always as ('partner'::text) stored,
  add column if not exists communication_contact text,
  add column if not exists final_reviewer text,
  add column if not exists settlement_party text;
do $$begin
  if not exists(select 1 from pg_constraint where conrelid='public.client_services'::regclass and conname='service_partner_channel') then
    alter table public.client_services add constraint service_partner_channel check (
      (deal_channel is null and partner_id is null) or
      (deal_channel is not distinct from 'direct' and partner_id is null) or
      (deal_channel is not distinct from 'partner' and partner_id is not null)
    );
    alter table public.client_services add constraint service_channel_values check (deal_channel in ('direct','partner'));
    alter table public.client_services add constraint service_partner_not_self check (partner_id is null or partner_id <> client_id);
    alter table public.client_services add constraint service_partner_kind_fk
      foreign key (partner_id, partner_kind) references public.clients(id, kind) on delete restrict on update restrict;
    alter table public.client_services add constraint service_contact_lengths check (
      char_length(communication_contact) <= 300 and char_length(final_reviewer) <= 300 and char_length(settlement_party) <= 300
    );
  end if;
end $$;
create index if not exists client_services_partner_idx on public.client_services(partner_id) where partner_id is not null;
comment on column public.client_services.deal_channel is 'NULL: not yet classified; direct: direct contract; partner: partner-sourced contract';
comment on column public.client_services.settlement_party is 'Operational settlement contact/party only. Does not modify invoices or payment records.';
-- Renew atomically and retain the per-contract routing/contact information.
-- Invoker rights: existing owner + Optify RLS policies apply to every statement.
create or replace function public.renew_client_service(service_id uuid, new_start date, new_end date)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare old_service public.client_services%rowtype; new_id uuid;
begin
  select * into old_service from public.client_services where id=service_id for update;
  if not found or old_service.billing <> 'period' or old_service.status <> 'active' then
    raise exception '진행 중인 기간제 계약을 선택해 주세요.';
  end if;
  if new_start is null or new_end is null or new_end < new_start then raise exception '계약 기간을 확인해 주세요.'; end if;
  insert into public.client_services(client_id,service_type,billing,status,start_date,end_date,monthly_fee,monthly_quota,memo,deal_channel,partner_id,communication_contact,final_reviewer,settlement_party)
    values(old_service.client_id,old_service.service_type,old_service.billing,'active',new_start,new_end,old_service.monthly_fee,old_service.monthly_quota,'재계약',old_service.deal_channel,old_service.partner_id,old_service.communication_contact,old_service.final_reviewer,old_service.settlement_party)
    returning id into new_id;
  update public.client_services set status='ended',updated_at=now() where id=service_id;
  if not found then raise exception '계약 변경 권한을 확인해 주세요.'; end if;
  return new_id;
end $$;
revoke all on function public.renew_client_service(uuid,date,date) from public,anon;
grant execute on function public.renew_client_service(uuid,date,date) to authenticated;
commit;
