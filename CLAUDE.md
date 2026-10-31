@AGENTS.md

# 옵티파이 워크스페이스 (Optify Workspace)

옵티파이(B2B SEO/GEO 마케팅)의 콘텐츠 제작·키워드 리서치·콘텐츠 플랜·월간 리포트를
통합 관리하는 2인용(owner 유리 + member 동생) 내부 웹앱. **현재 상태의 단일 기준은 이 문서(CLAUDE.md)** 다.
`optify-workspace-build-spec.md` 는 2026-07 초기 명세(역사 문서), 감사 문서는 날짜가 있는 과거 기록으로 본다. DB 셋업·적용 순서는 `supabase/README.md`.

## 핵심 설계 원칙 (반드시 준수)
1. **Client-scoped** — 옵티파이 자체가 `is_internal=true`인 첫 클라이언트. 고객사 추가는 코드 수정 없이 데이터 추가로.
2. **프리셋 기반 통합 생성 엔진** — 채널별 생성기 분리 금지. 하나의 엔진이 `channel_settings.preset`을 읽어 동작.
3. **채널 확장 대비** — channel은 DB에 `text`(enum/union 하드코딩 금지). 추후 `naver_place` 예정. 표시용 메타는 `src/lib/channels.ts` 레지스트리.
4. **권한은 RLS로 강제** — UI 숨김으로 끝내지 않고 DB 레벨 차단.

## 기술 스택
Next.js 16 (App Router, ⚠️ AGENTS.md 참고: 학습 데이터와 다른 breaking change 있음) · TypeScript ·
Tailwind v4 (CSS `@theme` 토큰, `tailwind.config` 파일 없음) · Supabase(Auth/DB/Storage/RLS) ·
Anthropic(콘텐츠) · Gemini(이미지) · Google Ads/GSC/GA4 · `@react-pdf/renderer`(Puppeteer 금지) · `docx`(견적·계약 문서).

## 디자인 토큰 (globals.css `@theme`)
옵티파이 트래커와 같은 화이트+블루(2026-09-06 전환). 악센트 블루 `--color-accent #2563EB`(버튼·포인트 전용, 넓은 면적 금지) ·
보조 딥블루 `--color-accent-deep #1D4ED8` · 틴트 `--color-tint #EFF6FF` · 잉크 `--color-ink #111827` · 옅은 배경 `--color-subtle #F4F6FA`.
화이트 모드 고정. 화면 컴포넌트에 색을 직접 박지 말고 토큰 클래스(`bg-accent`, `text-accent-deep`, `bg-tint`)를 쓴다.
PDF 문서(`lib/export/*-pdf.tsx`)·카드뉴스·브랜드 설명(`lib/generation/business-context.ts`)의 네온 그린은 옵티파이 브랜드 자산이라 그대로 둔다.

## 보안 불변 규칙
- `.env*`·서비스계정 JSON 절대 커밋 금지(`.gitignore`에 반영됨).
- WP Application Password는 `channel_settings.wp_app_password_encrypted`에 암호화 저장, **복호화는 서버(API Route)에서만**.
- `SUPABASE_SERVICE_ROLE_KEY`·`GOOGLE_SERVICE_ACCOUNT_KEY`는 서버 전용. 클라이언트 번들 유입 금지.
- 근거 없는 통계·수치 생성 금지 — 생성 프롬프트(`lib/generation/brand-rules.ts`)에 필수 포함.
- **XSS**: 생성 결과 미리보기·라이브러리 상세는 AI 생성 HTML을 `dangerouslySetInnerHTML`로 렌더한다
  (`components/generate/content-result.tsx`). 내부 2인용 도구·신뢰 소스 전제라 현재는 sanitize 미적용.
  **외부에 공개(고객 열람 링크, 퍼블릭 페이지 등)하는 시점에는 반드시 HTML sanitize(예: DOMPurify) 도입**할 것.

## 현재 상태
Phase 1 완료(생성 엔진·WP/네이버/스레드·키워드·플랜·라이브러리·대시보드), Phase 2 진행 중(리포트).
영업 축 완료(owner 전용): /quotes 견적서(품목은 손으로 입력 — 카탈로그 선택 UI 2026-09-06 제거, `lib/quote-items.ts`는 진단 프리필·단위용; 공급자·계좌·지급조건 `lib/quote-config.ts`,
계약 조항 `lib/contract-terms.ts`, 계약서·청구서는 견적 내역의 문서 생성 드롭다운) + /sales 리드 파이프라인·매출
대시보드(수주 리드 → 클라이언트 전환 시 온보딩 태스크 자동 발급) + /diagnosis SEO 진단(`lib/seo-audit/` —
라이브 체크 + 스크리밍프로그 Internal CSV 교차 검증, AI 소견, PDF 리포트, 실패 항목 → 견적 초안 자동 생성).
거래 경로 구분(`lib/deal-channels.ts`): 직접/소개/파트너 경유 — 파트너 경유 건은 세금계산서 거래처=파트너(partner_name),
실고객은 end_client_name(문서에 '건명'으로 표기). 매출 대시보드에 경로별 수주 구성 집계.
/revenue 매출: 세금계산서 발행 이력 수기 입력(수주 견적 프리필 지원) — 발행/입금/미수금 집계 + 거래처별 월 적층 차트.
팀 운영 축(owner·member 공용): /tasks 업무 보드(목록·칸반 드래그, 레지스트리 `lib/tasks.ts`) + 반복 업무 템플릿(월 운영
계약 연결, `/api/tasks/cron`이 매일 KST 00:20에 발행일 체크 — vercel.json crons) + /schedule 캘린더(events+업무
마감+계산서 발행일 병합, 레지스트리 `lib/schedule.ts`) + 대시보드 '이번 주 업무' 위젯.
AI 비서(상시 패널 → `/api/assistant`, Claude Fable 5.1 tool-use 루프, 도구는 `lib/assistant/tools.ts` 레지스트리):
세금계산서·입금·리드 등록 + 업무·일정 등록/조회/상태 변경 + 매출 요약(owner 전용). 실행은 사용자 세션 → RLS 적용.
/sales·/revenue는 member도 조회 가능(0023 — select 팀, 쓰기 owner. 페이지는 readOnly 모드로 편집 UI 숨김).
/ledger 회계 장부(팀 공용 기입, 레지스트리 `lib/ledger.ts`): 입금·지출·카드 내역 수기 기입 + 세금계산서
입금(invoice_payments) 자동 병합 표시(이중 기입 방지) + 월 단위 세무 전달용 CSV(UTF-8 BOM) 내보내기.
옵티파이 트래커 연동 A단계(2026-09-06, 읽기 전용): 맥의 `~/optify-tracker`(GEO·SEO 측정기)가 실행·리포트 뒤 `tracker sync`로
결과를 Supabase 에 올린다(`tracker_*` 테이블 7개 + `tracker_jobs` 대기열 + Storage `tracker` 버킷, `clients.tracker_slug` 로 연결).
/tracking 화면(개요·추세·결과 보기, `components/tracking/`, 라벨·계산은 `lib/tracker.ts`) + 대시보드 위젯(`components/dashboard/tracker-summary.tsx`).
'지금 실행'·고객사 등록 마법사(B단계)와 콘텐츠 발행→조치 기록·키워드→질문·리포트 섹션·AI 비서 도구(C단계)는 아직 맥 앱에 있다.
사이드바·화면 IA(2026-09-06 개편 1차, `lib/nav.ts`): **질문 다섯 개** — 오늘(/ = 처리할 일 표, `components/today/`) · 고객사(/clients 목록 → `/clients/[id]/{overview|content|seo|geo|reports|info}` 고객사 카드, `components/clients/`) ·
영업(/sales, /diagnosis, /quotes) · 정산(/revenue, /ledger) · 일정(/schedule, /tasks) + 보조(설정=팀·연동·사용량, 데일리 소식).
고객사 카드: `ClientShell` 이 주소의 고객사를 선택 고객사로 맞춘 뒤 기존 화면(플랜·생성·라이브러리·키워드·트래커·리포트)을 탭 안에 그대로 넣는다. 기본정보 탭 = 옛 설정의 고객사 항목(`components/clients/client-info-sections.tsx` 로 분리) + 메모 자동 저장.
옛 주소(/plans /generate /library /keywords /reports /tracking)는 `LegacyRedirect` 가 지금 고객사 카드 탭으로 보낸다(쿼리 유지) — 링크를 고칠 필요 없음.
**결정(2026-09-06)**: 팀원 2명 모두 같은 권한(둘 다 owner, 0027 에서 갱신) → ownerOnly·readOnly 구분은 코드에 남아 있어도 UI 에서 쓰지 않는다. 콘텐츠 표시 상태는 다섯 개(기획 중·검수 필요·수정 필요·발행 준비·발행 완료, 2차에서 작업 목록으로).
홈(/)은 캘린더 우선: `components/today/home-calendar.tsx`(날짜 눌러 바로 일정 추가·삭제, 업무 마감·계산서·발행 예정 겹침) + 옆의 작은 메모 `TodayMemo`(누르면 세부·행동 버튼) + 고객사 한눈에 + 트래커 요약.
개편 2차(2026-09-06): 고객사 › 콘텐츠 기본 보기 = `components/clients/content-work-list.tsx` (다섯 상태를 플랜·승인·발행 값으로 계산 — `buildWorkItems`, 다음 행동 `nextAction`);
기본정보 › 콘텐츠 기준 `client-brief.tsx` → `client_briefs`(0028) → `lib/generation/brand-rules.ts briefBlock` 으로 생성 프롬프트 주입; 회사 정보 칸(0028 컬럼이 있을 때만 표시·저장);
계약 항목명 자유 입력(`settings/client-services.tsx`, 추천 목록은 datalist) + 청구 방식 + 월 약정(`client_services.monthly_quota`) → 목록·개요 '약정 n건 중 발행 m건';
정산 입금 상태는 입금 합계로 계산해 표시.
**리포트 축소(2026-09-06 결정)**: 고객사 탭 '서치콘솔 · GA4'(`components/reports/google-report-view.tsx`, 주소 /clients/[id]/reports) = 구글 서치콘솔·GA4 결과만 불러와 KPI·차트·기회 키워드·월별 추이로 정리. 네이버 수치 입력·스크린샷 분석·AI 소견·PDF/docx 내보내기·확정은 제거(관련 API·export 모듈 삭제). `reports` 표는 월별 스냅샷(gsc_snapshot·ga4_snapshot) 저장용으로만 쓴다.
코덱스 검토 반영(2026-09-06, 0026_hardening.sql + 코드): ① 고객사를 바꾸면 생성·라이브러리·리포트 화면을 새로 그린다(고객사 카드는 id 로 키), WP 초안 전송·생성 API 는 서버가 글·플랜의 소속 고객사·채널을 확인.
② member 의 role 변경은 DB 트리거로 차단, profiles·clients·channel_settings·api_usage_logs·daily_reports 읽기도 팀원(`is_team_member()`)만, 채널 비밀번호 조회는 프로필 있는 계정만.
③ 저장된 HTML 은 DOMPurify(`lib/sanitize.ts`)로 정화해서만 그리고 서버 렌더에서는 그리지 않는다. `lib/text.ts` 는 속성값 이스케이프 + http(s)·상대 경로만 허용.
④ `/api/tasks/cron` 미들웨어 공개 경로 등록, 발행일 이후면 따라잡기, 계약 진행중·기간 안일 때만, `tasks.issued_ym` 유니크로 중복 방지, due_date 부여.
⑤ **발행 규칙**: '발행 완료'(published_at)는 승인된 글만(액션 + DB 트리거). WP '초안' 전송은 승인 전에도 가능(초안이지 공개 아님). 승인 뒤 본문을 고치면 자동으로 다시 검수 대기.
⑥ **발행 집계 기준은 `lib/publish-stats.ts` 하나**: 발행 = published_at, 월 귀속은 KST published_at 기준(생성량은 created_at). WP 초안만 보낸 글은 '발행'이 아니다. 리포트에 'WP 초안만'·'외부 작성 발행'을 따로 표시.
⑦ 생성 화면에서 고친 본문은 '수정 내용 저장'을 눌러야 라이브러리에 반영되고, 저장 전엔 완료 처리를 막는다.
⑧ 외부 고객사 글에는 옵티파이 정체성 규칙·옵티파이 블로그 카테고리 체계를 넣지 않는다(`lib/generation/brand-rules.ts` COMMON/OPTIFY 분리, 화자는 고객사, 카테고리는 channel_settings.category). 고객사 프리셋 편집 UI 복원은 아직 안 함.
⑨ 매출 상태·입금일 변경은 서버 액션(`lib/actions/revenue.ts`)이 입금 합계를 다시 읽어 남은 금액을 기록/자동 기록분 삭제·날짜 동기화 → 입금·미수금 집계와 일치.
⑩ 트래커 화면은 최근 12주만, 1,000행 단위로 나눠 읽고 조회 오류를 '데이터 없음'과 구분(`lib/tracker.ts` fetchAllRows).
⑪ SSRF: `lib/url-guard.ts` 가 IPv6 매핑·DNS 결과·리다이렉트 단계까지 검사(`isSafePublicUrlResolved`, `safeFetch` — WP 호출도 사용). 이미지 생성·비서 API 는 프로필 있는 계정만.
검증: `npm test`(vitest — text·publish-stats·url-guard), `npm run lint`, `npx tsc --noEmit`, `npm run build` 모두 통과가 커밋 조건.
트래커 B단계(2026-09-07): 고객사 › SEO·GEO 탭 위의 `components/tracking/tracker-controls.tsx` — '지금 실행'(tracker_jobs kind run, 표면=그 탭의 켜진 표면)과 '자동 실행 설정'(kind settings: 매주 자동 on/off + 표면 체크) 요청을 넣고 10초마다 결과를 본다. 맥 워커(`tracker jobs`, 1분)가 처리하고 `tracker_worker.last_seen`(0029)으로 살아 있음을 표시.
GEO 탭 = Peec AI(2026-09-28): `clients/[id]/geo/page.tsx` 가 `components/tracking/peec-geo-view.tsx`(노출률·채널별·일별·점유율·질문×채널·인용 출처, 7/14/30일)를 기본으로 보여 주고, 맥 직접 측정 기록은 아래 접힌 칸(`TrackingView hideControls`). 데이터는 `/api/peec/summary`(GET clientId·days, 팀원, 10분 메모 캐시) → `lib/peec.ts`(PEEC_API_KEY 회사 키, 프로젝트는 우리 브랜드 도메인 ↔ clients.website_url, 없으면 이름). 키는 .env.local·Vercel(Production·Preview). 맥의 GEO 직접 측정은 껐다(SEO 순위는 유지). GEO 탭 '추론 생성' → `/api/peec/insight`(Claude REASONING_MODEL, 자료는 `lib/peec.ts` `peecDigest` 만) → `tracker_insights`(scope geo, run_id `peec:시작~끝`). '리포트 PDF' → `/api/peec/report-pdf`(`lib/export/peec-report-pdf.tsx`, tracker-report-pdf 의 표·그래프 부품 재사용, 그 기간 최신 추론 포함). 공용 로더 `lib/peec-server.ts`(10분 캐시).
사업자등록증(2026-10-23): 기본정보 `components/clients/biz-reg-card.tsx` → `/api/clients/[id]/biz-reg`(GET 서명 URL 10분 / POST multipart JPG·PNG·WEBP·PDF ≤4MB / DELETE). 비공개 버킷 `client-docs/<clientId>/business-registration/<시각>.<ext>` 한 장만 보관, 버킷 정책 없이 서버에서 팀원 확인 후 관리자 키로 처리(버킷은 없으면 자동 생성). 구분(고객사/협업사)은 기본정보 이름 아래 버튼.
서치콘솔·GA4 권한(2026-09-23): 조회는 `GOOGLE_SERVICE_ACCOUNT_KEY` 의 서비스 계정으로 하므로 고객사 서치콘솔(사용자 및 권한)·GA4(속성 액세스 관리)에 그 계정을 사용자로 추가해야 한다. `/api/google/service-account`(GET, 팀원)가 이메일을 주고 서치콘솔·GA4 화면이 안내·복사 버튼으로 보여 준다. 403/PERMISSION_DENIED 는 `friendlyGoogleError` 로 사람 말로. URL 접두 속성은 `normalizeSiteUrl` 이 끝에 / 를 붙인다(없으면 403). `resolveSiteUrl` 이 sites.list 로 서비스 계정이 볼 수 있는 같은 도메인 속성(sc-domain ↔ https://…/ ↔ www)을 자동으로 골라 조회하고 스냅샷 `siteUrl`·`note` 에 남긴다 — 고객사가 URL 속성에만 권한을 줬는데 설정이 sc-domain 이라 403 났던 사례(2026-09-23).
서치콘솔·GA4 자동 갱신: `clients.google_auto_fetch`(0029) + `/api/reports/cron`(매일 KST 00:30, 월요일=이번 달 갱신·2일=지난달 확정, vercel.json) — 화면의 '자동 갱신' 체크. 미들웨어 공개 경로에 등록.
측정 기록·추론·PDF(2026-09-07): SEO·GEO 탭 기본 보기 = `components/tracking/records-tab.tsx` — 날짜·시간별 측정 목록 → 고른 측정의 KPI·표면별 그래프·질문(검색어)별 표(`lib/tracker-digest.ts` 순수 함수로 요약, 서버·PDF 공용).
측정 키워드·질문(2026-09-08): 고객사 › 기본정보 `components/clients/tracker-targets-card.tsx` — 메인 키워드 ≤5·서브 ≤20·질문 ≤20(의도 정보형/지역형/검색형/추천형 선택, 비우면 트래커가 추정)을 `tracker_targets`(0031)에 저장하고 `tracker_jobs` kind=targets 로 맥에 보낸다. 맥 `tracker/targets.py` 가 client.yaml 의 keywords(tier main/sub)·prompts 를 그 목록에 맞춘다(같은 글자는 id 유지, 없는 건 active:false, 새 건 새 id). 정리·한도는 `lib/tracker-targets.ts`(테스트 있음). 맥이 올리는 검색어 스냅샷은 `tracker_keywords`(0031). 저장된 게 없으면 맥의 현재 목록을 미리 채운다.
'추론 생성' → `/api/tracker/insight` (Claude `REASONING_MODEL`=claude-fable-5-1, betas+fallbacks, 자료 다이제스트만 근거) → `tracker_insights`(0030). '리포트 PDF' → `/api/tracker/report-pdf` (@react-pdf/renderer, `lib/export/tracker-report-pdf.tsx`: 요약·표·직전 대비·12주 추이·추론, 고객사 전달용). 측정 묶음 로더는 `lib/tracker-server/load-run.ts`.
DB: `supabase/migrations/0001~0035`. DDL은 SQL Editor에서 수동 실행 (0013=quotes, 0014=leads·app_settings, 0015=seo_diagnoses, 0016=deal_channels, 0017=tax_invoices, 0018=invoice_payments, 0019=client_services, 0020=channel_connection, 0021=tasks·task_templates, 0022=events, 0023=매출·영업 조회 팀 확대, 0024=ledger_entries, 0025=tracker_* 트래커 연동, 0026=보안·정합성 강화, 0027=승인 트리거 보완 + 권한 통일, 0028=회사 정보·월 약정·client_briefs, 0029=google_auto_fetch·tracker_worker, 0030=tracker_insights, 0031=tracker_targets·tracker_keywords, 0032=clients.kind 고객사/협업사). **0002 는 재실행 금지**(정책 전부 삭제).
각 기능 완료 시 빌드·타입체크 통과 후 커밋.


리뉴얼(2026-11-01): 상단 메뉴·상시 비서·고객별 진행 현황과 확인 대기 홈을 구현. 비서 쓰기는 `assistant_action_requests` 초안 → 사용자의 확인 버튼 → `resolve_assistant_action` 순서로만 실행한다. 초안은 생성자만 열람하고, 확인 시 권한·대상 최신 상태·만료를 재검증한다. 대기 대상·사유·재확인일과 `task_activity` 이력을 함께 표시한다. 업무 완료는 고객 보고·전달·확인 완료를 의미하지 않는다.
0033 적용 완료(2026-11-01): `riblksexnoijlgruviqi` / optify_workspace의 main DB에 SQL Editor로 적용. 사전 조회에서 관련 테이블·함수·트리거가 모두 없음을 확인해, 0033의 존재하지 않는 규칙 제거 구문 5개를 생략하고 함수는 신규 생성하여 동일한 최종 구조를 만들었다. 새 저장 항목 API 200 및 로그인 없는 승인 요청 차단 확인. 로컬 검증 42개 + 임시 PostgreSQL 검증 12개, 빌드·PC/모바일 화면 검증 통과. 운영 웹 배포는 `RIDI25/optify_workspace`의 `main` 브랜치에 연결된 Vercel `optify-workspace` 프로젝트를 사용한다. 운영 주소는 https://optify-workspace-sepia.vercel.app/ 이며, 최신 적용 커밋과 배포 성공 여부는 Vercel에서 확인한다.

운영 확인(2026-11-01): 리뉴얼 첫 커밋 `17a02ac`의 Vercel Production Ready 및 기존 운영 도메인 연결, 실제 로그인 후 홈·고객 목록·비서 업무/일정 조회와 메뉴 이동 시 대화 유지 확인. 홈 달력은 서버에서 계산한 한국 날짜를 전달해 서버 UTC와 브라우저 KST의 월·일 불일치를 방지한다. 10월 말 UTC/11월 초 KST 경계의 렌더 결과 일치 검증 통과.

비서 기획 지원(2026-11-01): `lib/anthropic.ts`의 `ASSISTANT_MODEL=claude-fable-5-1`을 사용한다. 계정 모델 목록에서 사용 가능 확인. 업무 처리에 더해 아이디어·제안서·미팅·우선순위를 대화로 정리하며 기획 제안만으로 업무를 등록하지 않는다. 실제 등록·변경은 기존 확인 버튼 절차를 유지한다. 추론과 기획 답변을 위해 출력 한도 8,192토큰, 대화에 포함되는 비서 답변은 최대 40,000자로 허용(사용자 메시지 8,000자, 최근 20개 전달). Fable 5.1 공식 입력/출력 단가를 비용 추정에 추가. 채팅 안내와 제안서 기획 시작 버튼 반영.

## 셋업 (Supabase)
`supabase/migrations/0001 → 0002 → 0003` 순서로 SQL Editor 실행. 이후 대시보드에서 owner/member
계정 생성 → 각 `auth.users`에 대응하는 `profiles` 행 삽입(role 지정). 키는 `.env.local`에 입력.

회의록·옵시디언 연결(2026-11-01): `/meetings`에서 팀 회의록 작성·고객사 연결·검색·수정·보관/복원·Markdown 내려받기를 지원한다. 비서 정리는 Fable 5.1로 초안만 만들고 사용자가 검토·적용·저장한다. 자동 업무 등록은 하지 않는다. 회의록 버전을 비교해 오래된 저장을 409로 거절하며, 브라우저 탭의 임시 초안을 복구할 수 있다.
0034 적용 완료: `meeting_notes`는 팀 공유, `vault_notes`와 `vault_sync_state`는 `owner_id=auth.uid()`로 본인만 조회(두 owner 사이에도 분리). 웹에서는 볼트 사본을 수정할 수 없다. `scripts/obsidian-sync.mjs`가 맥의 전체 볼트에서 보이는 Markdown만 읽어 기존 서비스 키로 원자적으로 갱신한다. 숨김 파일·심볼릭 링크·1MB 초과 파일 제외, 스캔 실패 시 기존 검색 사본 유지, 정상 스캔에서 없어진 노트는 검색에서 제외. 노트 인덱싱은 볼트를 읽기만 한다. 비서 `search_notes`/`read_note`는 사용자 RLS로 회의록·개인 볼트 검색 및 본문 조회, 출처 표기, 참고 자료 내부 명령 무시. 설치·중지 방법은 `docs/obsidian-connection.md`.

비서 채팅·주간 보관(2026-11-01): `/assistant` 전용 메뉴와 다른 업무 화면의 우측 하단 호출 버튼을 사용한다. `WorkspaceShell`에 비서 인스턴스를 유지해 메뉴/팝업 간 대화를 이어간다. `assistant_conversations/messages/turns`에 본인 대화만 저장하며, 요청을 먼저 저장한 후 Fable을 호출한다. 요청 ID 중복·동시 실행 방지, 3분 만료 복구, 도구 확인 결과 메시지 저장, 고정 기능을 지원한다. 0035는 기존 승인 기능을 `resolve_chat_assistant_action`으로 감싸 작업 결과와 대화 기록을 함께 남긴다.
주간 보관은 기존 맥 연결 작업에 `scripts/assistant-archive.mjs`로 통합한다. 매주 월요일 09:00 KST 이후 직전 월요일~일요일의 미보관 메시지를 순차 처리하며, 맥이 쉬고 있었으면 다음 실행에서 따라잡는다. 볼트 `40_기록/옵티파이 비서/YYYY-MM-DD/`에 Fable 요약과 전체 원문(메타데이터 포함)을 따로 쓴다. 두 파일의 내용을 다시 읽고 해시가 일치한 뒤에만 보관 완료를 기록한다. 기존 파일이 다르면 덮어쓰지 않고 대화를 유지한다. 완료 시 고정되지 않고 새 미보관 메시지·진행 중 응답·유효한 확인 대기가 없는 대화방만 앱 목록에서 숨긴다. 원본 대화는 복구 가능하도록 DB에 보존한다. 개인 대화를 팀 공간이나 Notion에 옮기지 않는다. 사용자 API는 보관 완료를 위조하거나 대화를 삭제할 수 없다.

0035 적용 완료(2026-11-01): 운영 main DB에 새 대화·메시지·응답·보관 테이블이 없음을 사전 확인하고 전체 SQL을 적용했다. 임시 PostgreSQL 검증 11개(개인 기록 격리, 요청 중복, 만료 복구, 승인 결과 저장, 파일 확인 전 정리 차단, 고정·새 메시지·대기 보호, 재실행 안전성), 파일 보관 검증 3개 통과. 일정 화면도 서버가 계산한 한국 날짜를 전달해 월 경계의 초기 화면 불일치를 막는다.

화면 공간 조정(2026-11-01): PC 메뉴를 232px 왼쪽 사이드바로 옮겼다. 계정 메뉴는 사이드바 아래, 작은 화면에서는 56px 헤더와 왼쪽 메뉴 드로어를 쓴다. 비서 전용 화면은 상단/외곽 여백 없이 전체 높이를 사용하고, 대화 제목과 업무 대상을 한 줄에 배치하며 입력 영역을 2줄로 줄였다. 좁은 화면에서는 대화 목록을 접어 열 수 있고, 기존 하단 호출·저장·고정·주간 보관 흐름을 유지한다.

메뉴 정리(2026-11-01): 최상위는 비서 채팅 → 캘린더 → 회의록 → 고객/협력사 → SEO/GEO → 정산 순서다. 오늘 할 일·업무 보드는 캘린더, 영업 관리·견적서/계약서는 고객/협력사, 사이트 진단과 고객별 SEO/GEO/검색 유입은 SEO/GEO에 묶는다. 현재 메뉴의 하위만 기본으로 펼치고 화살표로 다른 묶음을 열 수 있다. 고객 카드의 개요·콘텐츠·기본정보는 고객/협력사, SEO·GEO·서치콘솔/GA4는 SEO/GEO를 강조한다. `/seo-geo`는 고객을 선택해 기존 성과 화면으로 진입하는 화면이다. 기존 데이터 구조·측정·진단 실행 방식은 유지한다.
