/** 모델별 100만 토큰당 단가(USD). api_usage_logs 비용 추정용. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
  // https://platform.claude.com/docs/en/models/fable-5-1/overview (2026-11-01)
  "claude-fable-5-1": { input: 10, output: 50 },
  // OpenAI GPT-5.6 Sol — 프로모션가($4/$20, ~2026-11-21). 이후 정가 $5/$30
  "gpt-5.6-sol": { input: 4, output: 20 },
};

/** 이미지 생성 모델: 호출(장)당 고정 단가(USD). [AUDIT M-4]
 *  gemini-2.5-flash-image: 이미지당 1290 출력 토큰 × $30/1M ≈ $0.039 */
const IMAGE_PRICING: Record<string, number> = {
  "gemini-2.5-flash-image": 0.039,
  // gpt-image-1: 1024×1024 medium ≈ $0.042
  "gpt-image-1": 0.042,
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const perImage = IMAGE_PRICING[model];
  if (perImage != null) return perImage;
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
