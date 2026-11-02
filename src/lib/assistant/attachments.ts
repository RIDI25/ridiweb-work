export const ATTACHMENT_BUCKET = "assistant-files";
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MESSAGE_FILE_BYTES = 20 * 1024 * 1024;
export const FILE_TYPES: Record<string, { mime: string; kind: "image" | "pdf" | "text" }> = {
  png: { mime: "image/png", kind: "image" }, jpg: { mime: "image/jpeg", kind: "image" }, jpeg: { mime: "image/jpeg", kind: "image" }, webp: { mime: "image/webp", kind: "image" }, gif: { mime: "image/gif", kind: "image" },
  pdf: { mime: "application/pdf", kind: "pdf" }, txt: { mime: "text/plain", kind: "text" }, md: { mime: "text/markdown", kind: "text" }, csv: { mime: "text/csv", kind: "text" }, json: { mime: "application/json", kind: "text" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "text" }, xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "text" }, xls: { mime: "application/vnd.ms-excel", kind: "text" }, pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "text" }, hwpx: { mime: "application/hwp+zip", kind: "text" },
};
export const ATTACHMENT_ACCEPT = Object.keys(FILE_TYPES).map(ext => `.${ext}`).join(",");
export interface ChatAttachment { id: string; filename: string; bytes: number; mime: string; kind: "image" | "pdf" | "text"; sha256?: string; pages?: number | null; note?: string }
export function fileSpec(filename: unknown, size: unknown) {
  if (typeof filename !== "string" || !filename.trim() || filename.length > 200 || /[\x00-\x1f/\\]/.test(filename)) throw new Error("파일 이름을 확인해 주세요.");
  const ext = filename.split(".").at(-1)?.toLowerCase() || "";
  const spec = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
  if (!spec) throw new Error("지원하지 않는 파일이에요. 이미지, PDF, Word(DOCX), Excel, PPTX, HWPX, 텍스트 파일을 선택해 주세요. HWP는 PDF로 변환해 주세요.");
  const max = spec.kind === "image" ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > max) throw new Error(`${filename}: ${max / 1024 / 1024}MB 이하의 파일을 선택해 주세요.`);
  return { ...spec, ext, filename: filename.trim(), bytes: size };
}
export const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.ceil(bytes / 1024))}KB`;
