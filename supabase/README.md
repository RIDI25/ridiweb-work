# Supabase 셋업

> ⚠️ **운영 DB 에서 `0002_rls.sql` 을 다시 실행하지 마세요.** 0002 는 public 스키마의 정책을 전부 지운 뒤 초기 정책만 다시 만들기 때문에
> 이후 기능(0007·0009·0013~0026)의 접근 정책이 사라집니다. 새 DB 에 처음 세팅할 때만 씁니다.
>
> **현재 상태(2026-09-06)**: `migrations/0001` → … → `0026_hardening.sql` 까지 파일 이름 순서대로 모두 실행돼 있어야 합니다.
> 접두사가 겹치는 `0008_default_assignee` / `0008_report_sections`, `0009_content_approval` / `0009_daily_reports` 는 서로 독립이라 둘 다 실행합니다.
> 새 마이그레이션은 SQL Editor 에서 손으로 실행하고, 적용한 번호를 CLAUDE.md 에 적습니다.

## 1. 마이그레이션 실행
Supabase 대시보드 → SQL Editor에서 아래 순서대로 실행:

1. `migrations/0001_schema.sql` — 테이블 + 인덱스
2. `migrations/0002_rls.sql` — RLS 활성화 + 정책 + `get_my_role()`
3. `migrations/0003_seed.sql` — 옵티파이 클라이언트 + 채널 프리셋 3종

재실행해도 안전하도록 작성돼 있습니다(idempotent).

## 2. 계정 생성 (공개 가입 없음)
Authentication → Users → **Add user**로 owner/member 계정을 직접 생성합니다.
비밀번호 방식(이메일/비밀번호).

## 3. profiles 행 연결
계정 생성 후, 각 사용자를 `profiles`에 등록해야 로그인·역할이 동작합니다.
SQL Editor에서(이메일을 실제 값으로 교체):

```sql
insert into profiles (id, name, role)
select id, '유리', 'owner' from auth.users where email = 'OWNER_EMAIL'
on conflict (id) do update set name = excluded.name, role = excluded.role;

insert into profiles (id, name, role)
select id, '동생', 'member' from auth.users where email = 'MEMBER_EMAIL'
on conflict (id) do update set name = excluded.name, role = excluded.role;
```

## 4. Storage 버킷 (Phase 1에서 사용)
- `blog-images` (public) — Gemini 생성 이미지
- 리포트 내보내기 파일 저장용 버킷은 Phase 2에서 추가
- `reports` / `quotes` (private) — 리포트·견적서 내보내기. 최초 내보내기 시 서버가 자동 생성.

## 5. 환경변수
Settings → API에서 URL / anon key / service_role key를 복사해 `.env.local`에 입력.


## 0033 — 비서 최종 확인·업무 대기 기록

리뉴얼 코드 배포 전에 `migrations/0033_assistant_confirmation_waiting.sql`을 해당 프로젝트 SQL Editor에서 한 번 실행한다. 트랜잭션으로 적용하며 재실행할 수 있다. 기존 0002 파일을 다시 실행하지 않는다.

- 비서의 등록·변경 요청은 본인만 읽는 초안으로 저장된다. 확인 또는 취소는 인증된 `resolve_assistant_action`을 통해 처리한다. 재확인은 같은 결과를 반환한다.
- 업무 대기 대상·사유·재확인일과 변경 이력이 추가된다. 기존 업무의 과거 이력은 소급 생성하지 않는다.
- 데이터베이스 설정 전에는 비서 변경 실행이 차단된다. 설정 오류를 즉시 실행 방식으로 우회하지 않는다.
- 홈택스 발행, 고객 발송, 계약 체결은 자동 수행하지 않는다.

검증: `npm test` 및 `npm run build`. 데이터베이스 검증은 `supabase/tests/assistant-confirmation.mjs`를 사용한다. 테스트용 `@electric-sql/pglite`를 별도 임시 폴더에 설치한 뒤 `PGLITE_MODULE`을 그 모듈의 `dist/index.js` 절대 경로로 지정하여 Node로 실행한다. 테스트는 메모리 데이터베이스와 예시 데이터만 사용하며 실제 Supabase에 연결하지 않는다. 동시 연결 부하 테스트는 포함하지 않는다.


## 0036 — 개인 강의 관리

`migrations/0036_lectures.sql`을 코드 배포 전에 실행한다. 2026-11-01 ridiweb-work (`riblksexnoijlgruviqi`)에 SQL Editor로 적용 완료. 새 테이블 3개이며 기존 업무 테이블은 변경하지 않는다. 재실행 가능. 본인 RLS와 문서별 저장 이력·버전 잠금, 확정본 수정 시 초안 전환을 적용한다. `PGLITE_MODULE`을 지정한 `node supabase/tests/lectures.mjs`로 계정 격리·소유권/이력 위조 차단·확정본 보존을 검증한다. 초기 실제 강의 정보는 사용자 화면에서 작성하며 마이그레이션에 개인 데이터를 넣지 않는다.
