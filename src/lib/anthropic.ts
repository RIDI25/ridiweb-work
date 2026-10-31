import Anthropic from "@anthropic-ai/sdk";

/** 콘텐츠 생성 기본 모델. 날짜 접미사 붙이지 말 것. */
export const GENERATION_MODEL = "claude-fable-5";

/** 업무 조회·확인 초안·기획 대화를 함께 맡는 비서 모델. */
export { ASSISTANT_MODEL } from "./ai-models";

/**
 * Fable 5는 안전 분류기가 요청을 거부(stop_reason: refusal)할 수 있어
 * 서버측 폴백을 기본 적용한다 — 거부 시 같은 요청을 Opus 4.8이 이어받는다.
 * 모든 호출은 client.beta.messages.*에 betas + fallbacks를 함께 전달할 것.
 */
export const GENERATION_BETAS = ["server-side-fallback-2026-06-01"];
export const GENERATION_FALLBACKS = [{ model: "claude-opus-4-8" }];

/** 서버 전용 Anthropic 클라이언트 (ANTHROPIC_API_KEY 환경변수 사용) */
export function createAnthropic() {
  return new Anthropic();
}

/** 트래커 추론(측정 해석)에 쓰는 모델 — 결정 21: 항상 최신 최고급. 측정 표면 모델과 별개. */
export const REASONING_MODEL = "claude-fable-5-1";
