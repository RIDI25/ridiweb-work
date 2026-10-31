/** RIDIWEB 비서 팀 기본값. 키와 요청 실행은 서버에서만 다룬다. */
export const ASSISTANT_MODEL = "claude-fable-5-1";
export const SPECIALIST_MODEL = "gpt-6-astra";
export const SPECIALIST_REASONING = "medium";
export const SPECIALIST_ROLES = {
  analysis: { label: "자료 분석", instruction: "제공된 자료를 비교·분석하고 근거, 해석, 빈 정보를 구분한다." },
  writing: { label: "초안 작성", instruction: "요청한 대상과 목적에 맞춰 문서·제안서·콘텐츠 초안을 작성한다." },
  seo_geo: { label: "SEO/GEO", instruction: "제공된 검색·AI 노출 자료를 해석해 개선 항목과 우선순위를 제안한다. 실행하지 않은 진단 결과를 만들지 않는다." },
  operations: { label: "업무 정리", instruction: "제공된 업무·일정·정산 정보를 정리하고 누락, 다음 행동, 확인할 항목을 제안한다. 실제 등록이나 변경은 하지 않는다." },
  review: { label: "검토", instruction: "초안의 논리, 근거, 누락, 수치 일관성을 검토하고 구체적인 수정안을 제안한다." },
} as const;
export type SpecialistRole = keyof typeof SPECIALIST_ROLES;
