-- ============================================================
-- 옵티파이 워크스페이스 — 고객사 / 협업사 구분 (0032, 2026-10-23)
-- clients.kind: 'client'(고객사, 기본) / 'partner'(협업사). 기존 행은 모두 고객사.
-- ⚠️ DDL — Supabase SQL Editor에서 수동 실행. 재실행 안전(멱등). 0002 는 재실행 금지.
-- ============================================================
alter table clients add column if not exists kind text not null default 'client';
alter table clients drop constraint if exists clients_kind_check;
alter table clients add constraint clients_kind_check check (kind in ('client', 'partner'));
create index if not exists idx_clients_kind on clients(kind);
