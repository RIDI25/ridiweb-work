/**
 * Supabase 데이터베이스 타입.
 * 스키마(supabase/migrations)와 수동 동기화. 추후 `supabase gen types`로 대체 가능.
 *
 * 주의(설계 원칙 #3): channel 값에 union/enum을 하드코딩하지 않는다.
 * 채널 추가가 데이터 추가만으로 가능하도록 channel은 string으로 둔다.
 */

export type Role = "owner" | "member";
export type ClientStatus = "active" | "paused" | "ended";
export type KeywordStatus = "candidate" | "planned" | "discarded";
export type PlanStatus = "idea" | "writing" | "review" | "published";
export type ReportStatus = "draft" | "final";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type QuoteStatus = "draft" | "sent" | "won" | "expired";
export type LeadStatus = "inquiry" | "consulting" | "quoted" | "won" | "lost";
/** 거래 경로: 직접 / 소개 / 파트너(리드젠랩 등) 경유 — 라벨은 lib/deal-channels.ts */
export type DealChannel = "direct" | "referral" | "partner";

/** 현재 사용되는 채널 값(참고용). 하드코딩 강제 아님 — string 어디에도 대입 가능. */
export const KNOWN_CHANNELS = ["naver_blog", "wordpress", "threads"] as const;

type Timestamps = { created_at: string };

export interface Profile extends Timestamps {
  id: string;
  name: string;
  role: Role;
}

export interface Client extends Timestamps {
  id: string;
  name: string;
  is_internal: boolean;
  status: ClientStatus;
  gsc_site_url: string | null;
  ga4_property_id: string | null;
  memo: string | null;
  created_by: string | null;
  /** 0025: 트래커 폴더 이름 */
  tracker_slug?: string | null;
  /** 0028: 회사 정보 (모두 선택) */
  industry?: string | null;
  region?: string | null;
  website_url?: string | null;
  blog_url?: string | null;
  place_url?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  /** 0029: 서치콘솔·GA4 자동 갱신 (크론) */
  google_auto_fetch?: boolean;
  /** 0032: 고객사(client) / 협력사(partner). 컬럼이 없으면 고객사로 본다 */
  kind?: ClientKind;
}

export type ClientKind = "client" | "partner";
export const CLIENT_KIND_LABEL: Record<ClientKind, string> = { client: "고객사", partner: "협력사" };
/** 컬럼 없는 DB(0032 전)·빈 값은 고객사 */
export const clientKind = (c: { kind?: string | null }): ClientKind => (c.kind === "partner" ? "partner" : "client");

/** 0028: 고객사 콘텐츠 기준 — 생성 엔진이 시스템 프롬프트에 넣는다 */
export interface ClientBrief {
  client_id: string;
  tone: string | null;
  audience: string | null;
  must_include: string | null;
  banned: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface ChannelSettings extends Timestamps {
  id: string;
  client_id: string;
  channel: string;
  preset: Record<string, unknown>;
  default_assignee: string | null;
  wp_url: string | null;
  wp_username: string | null;
  wp_app_password_encrypted: string | null;
  /** 채널 계정/연결 정보 (0020) — 네이버 아이디 등 */
  account_id: string | null;
  account_password_encrypted: string | null;
  channel_url: string | null;
  category: string | null;
  is_active: boolean;
}

export interface Keyword extends Timestamps {
  id: string;
  client_id: string;
  keyword: string;
  avg_monthly_searches: number | null;
  competition: string | null;
  cpc_low: number | null;
  cpc_high: number | null;
  source: string | null;
  status: KeywordStatus;
  memo: string | null;
}

export interface ContentPlan extends Timestamps {
  id: string;
  client_id: string;
  keyword_id: string | null;
  title: string;
  channel: string;
  status: PlanStatus;
  scheduled_date: string | null;
  assignee: string | null;
  memo: string | null;
  external_url: string | null;
}

export interface ContentImage {
  url: string;
  alt: string;
  filename: string;
  /** 주제·키워드 기반 한국어 이미지 제목 (WP 미디어 제목/캡션용) */
  title?: string;
}

export interface ContentMeta {
  slug?: string;
  meta_description?: string;
  faq?: { question: string; answer: string }[];
  /** 네이버 블로그 카테고리 라벨 */
  naver_category?: string;
}

export interface Content extends Timestamps {
  id: string;
  client_id: string;
  plan_id: string | null;
  channel: string;
  content_type: string | null;
  title: string | null;
  body: string;
  images: ContentImage[] | string[];
  meta: ContentMeta | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  wp_post_id: number | null;
  published_at: string | null;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
}

export interface ContentComment {
  id: string;
  content_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

/** 섹션별 AI 리포트 텍스트 (ai_summary는 종합 리포트) [migrations/0008] */
export interface SectionReports {
  google?: string;
  naver?: string;
}

export interface Report extends Timestamps {
  id: string;
  client_id: string;
  year_month: string;
  gsc_snapshot: Record<string, unknown> | null;
  ga4_snapshot: Record<string, unknown> | null;
  naver_manual_metrics: NaverManualMetrics | null;
  content_summary: Record<string, unknown> | null;
  next_month_plans: Record<string, unknown> | null;
  ai_summary: string | null;
  section_reports: SectionReports | null;
  exported_files: { format: string; storage_path: string; exported_at: string }[];
  status: ReportStatus;
}

/** 견적 품목 행 (quotes.items jsonb) — 발행 시점 스냅샷 */
export interface QuoteLineItemRow {
  category: string | null; // 카탈로그 카테고리, 수기 품목은 null
  name: string;
  detail: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
}

export interface Quote extends Timestamps {
  id: string;
  quote_no: string;
  customer_name: string;
  customer_contact: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  quote_date: string;
  valid_until: string | null;
  items: QuoteLineItemRow[];
  vat_mode: "excluded" | "included";
  supply_amount: number;
  vat_amount: number;
  total_amount: number;
  notes: string | null;
  status: QuoteStatus;
  exported_files: {
    format: string;
    storage_path: string;
    exported_at: string | null;
    doc_type?: string; // 'quote' | 'contract' | 'invoice' (기본 quote)
    stage?: string; // invoice: 'full' | 'deposit' | 'balance'
  }[];
  lead_id: string | null;
  won_at: string | null;
  deal_channel: DealChannel;
  partner_name: string | null; // 파트너명(세금계산서 거래처) 또는 소개자명
  end_client_name: string | null; // 실고객(건명) — 파트너 경유 시 구분용
  created_by: string | null;
  updated_at: string;
}

export interface Lead extends Timestamps {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  region: string | null;
  source: string | null;
  status: LeadStatus;
  next_followup: string | null;
  client_id: string | null;
  memo: string | null;
  deal_channel: DealChannel;
  partner_name: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface AppSetting {
  key: string;
  value: string | null;
  updated_at: string;
}

export type TaxInvoiceStatus = "issued" | "paid" | "cancelled";

/** 세금계산서 발행 이력 (수기 입력) — /revenue 매출 대시보드 데이터 소스 */
export interface TaxInvoice extends Timestamps {
  id: string;
  issue_date: string;
  counterparty: string; // 세금계산서 상 거래처
  end_client_name: string | null; // 실고객(건명)
  description: string | null;
  supply_amount: number;
  vat_amount: number;
  total_amount: number;
  deal_channel: DealChannel;
  quote_id: string | null;
  status: TaxInvoiceStatus;
  paid_at: string | null;
  memo: string | null;
  created_by: string | null;
  updated_at: string;
}

export type ServiceStatus = "active" | "done" | "paused" | "ended";

/** 고객사 계약 서비스 — 업무 플로우 구분 기준. service_type은 lib/services.ts 레지스트리 키 */
export interface ClientService extends Timestamps {
  id: string;
  client_id: string;
  service_type: string;
  billing: "one_time" | "period";
  status: ServiceStatus;
  /** 0028: 월 약정 수량 (콘텐츠 계약) */
  monthly_quota?: number | null;
  start_date: string | null;
  end_date: string | null;
  amount: number | null;
  monthly_fee: number | null;
  quote_id: string | null;
  memo: string | null;
  updated_at: string;
}

export type PaymentKind = "deposit" | "balance" | "full" | "other";

/** 인보이스별 입금 내역 — 선금/잔금 분할 입금 기록 */
export interface InvoicePayment extends Timestamps {
  id: string;
  invoice_id: string;
  paid_date: string;
  amount: number;
  kind: PaymentKind;
  memo: string | null;
}

/** 팀 업무 — status/task_type/priority는 lib/tasks.ts 레지스트리 키 (text) */
export interface Task extends Timestamps {
  waiting_on?: string;
  waiting_reason?: string | null;
  waiting_since?: string | null;
  followup_date?: string | null;
  id: string;
  title: string;
  client_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  status: string;
  task_type: string;
  priority: string;
  memo: string | null;
  template_id: string | null;
  created_by: string | null;
  updated_at: string;
}

/** 팀 일정 — event_type은 lib/schedule.ts 레지스트리 키 (text) */
export interface CalendarEvent extends Timestamps {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  event_type: string;
  client_id: string | null;
  assignee_id: string | null;
  memo: string | null;
  created_by: string | null;
  updated_at: string;
}

/** 반복 업무 템플릿 — 월 운영 계약(client_services)에 연결, cron이 매월 발행 */
export interface TaskTemplate extends Timestamps {
  id: string;
  client_service_id: string;
  title: string;
  assignee_id: string | null;
  issue_day: number;
  task_type: string;
  priority: string;
  active: boolean;
  last_issued_ym: string | null;
  created_by: string | null;
  updated_at: string;
}

/** 회계 장부 — entry_type/payment_method/category는 lib/ledger.ts 레지스트리 키 */
export interface LedgerEntry extends Timestamps {
  id: string;
  entry_date: string;
  entry_type: string;
  payment_method: string;
  amount: number;
  counterparty: string | null;
  description: string | null;
  category: string;
  memo: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface SeoDiagnosis extends Timestamps {
  id: string;
  url: string;
  lead_id: string | null;
  has_csv: boolean;
  total_score: number | null;
  results: Record<string, unknown>; // lib/seo-audit/types.ts DiagnosisResult
  ai_summary: string | null;
  exported_files: { format: string; storage_path: string; exported_at: string | null }[];
  created_by: string | null;
}

export interface ApiUsageLog extends Timestamps {
  id: string;
  user_id: string | null;
  client_id: string | null;
  provider: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
}

/** 네이버 수동 입력 지표 정형 스키마 (월별 추이용 고정 키) */
export interface NaverManualMetrics {
  blog_total_views: number;
  blog_visitor_count: number;
  top_inflow_keywords: { keyword: string; count: number }[];
  place_views: number | null;
  place_inquiries: number | null;
  note: string;
}

/** 테이블별 Row/Insert/Update 헬퍼 */
type TableShape<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: TableShape<Profile>;
      clients: TableShape<Client>;
      channel_settings: TableShape<ChannelSettings>;
      keywords: TableShape<Keyword>;
      content_plans: TableShape<ContentPlan>;
      contents: TableShape<Content>;
      reports: TableShape<Report>;
      quotes: TableShape<Quote>;
      leads: TableShape<Lead>;
      app_settings: TableShape<AppSetting>;
      seo_diagnoses: TableShape<SeoDiagnosis>;
      tax_invoices: TableShape<TaxInvoice>;
      invoice_payments: TableShape<InvoicePayment>;
      client_services: TableShape<ClientService>;
      tasks: TableShape<Task>;
      task_templates: TableShape<TaskTemplate>;
      events: TableShape<CalendarEvent>;
      ledger_entries: TableShape<LedgerEntry>;
      api_usage_logs: TableShape<ApiUsageLog>;
    };
    Views: Record<string, never>;
    Functions: {
      get_my_role: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
