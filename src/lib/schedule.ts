/**
 * 스케줄(일정) 레지스트리 — event_type 표시 메타 + 캘린더 소스별 색.
 * DB(events.event_type)는 text — 하드코딩 enum 금지 원칙.
 */

export interface EventTypeDef {
  key: string;
  label: string;
}

export const EVENT_TYPES: EventTypeDef[] = [
  { key: "meeting", label: "미팅" },
  { key: "deadline", label: "마감" },
  { key: "publish", label: "발행" },
  { key: "etc", label: "기타" },
];

export const eventTypeLabel = (key: string) =>
  EVENT_TYPES.find((t) => t.key === key)?.label ?? key;

/** 캘린더 소스별 칩 색 — 악센트 넓은 면적 금지 원칙에 따라 작은 칩에만 사용 */
export const SOURCE_STYLES: Record<string, string> = {
  lecture: "bg-tint text-accent-deep",
  event: "bg-tint text-accent-deep",
  task: "bg-blue-50 text-blue-700",
  invoice: "bg-amber-50 text-amber-700",
};

export const SOURCE_LABELS: Record<string, string> = {
  lecture: "강의",
  event: "일정",
  task: "업무 마감",
  invoice: "세금계산서",
};

/** 요일 표시 — 일요일 시작 (2026-09-07 결정). 인덱스 = Date.getDay() */
export const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
/** @deprecated 일요일 시작으로 바뀜 — DOW_KO 를 쓰세요 (같은 배열) */
export const DOW_KO_MON = DOW_KO;

export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 월 그리드 — 일요일 시작, 앞뒤 빈 칸은 null (홈 캘린더·스케줄 페이지 공용) */
export function buildMonthGrid(y: number, m: number): (string | null)[][] {
  const startDow = new Date(y, m, 1).getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(startDow).fill(null),
    ...Array.from({ length: daysIn }, (_, i) => ymdOf(new Date(y, m, i + 1))),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
