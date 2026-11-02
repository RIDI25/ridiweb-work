import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectAttachment, imageForModel } from "../attachment-content";
import { fileSpec } from "../attachments";
import { attachmentTool } from "../attachment-tools";
const png = () => sharp({ create: { width: 48, height: 32, channels: 3, background: "#7854c6" } }).png().toBuffer();
describe("attachment validation and usable content", () => {
  it("accepts supported names but rejects paths, executable extensions, empty files and excessive sizes", () => {
    expect(fileSpec("모임.JPG", 100).mime).toBe("image/jpeg");
    for (const [name, size] of [["../x.pdf", 10], ["x.html", 10], ["x.png", 5242881], ["x.pdf", 10485761], ["x.txt", 0], ["x.hwp", 10]] as const) expect(() => fileSpec(name, size)).toThrow();
  });
  it("checks image bytes and creates a model-readable image", async () => {
    const bytes = await png(); expect((await inspectAttachment("사진.png", bytes)).kind).toBe("image");
    await expect(inspectAttachment("사진.jpg", bytes)).rejects.toThrow("형식");
    await expect(inspectAttachment("사진.png", Buffer.from("not an image"))).rejects.toThrow();
    expect((await sharp(await imageForModel(bytes)).metadata()).format).toBe("png");
  });
  it("validates PDFs and rejects excessive pages", async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    expect((await inspectAttachment("자료.pdf", Buffer.from(await doc.save()))).pages).toBe(1);
    for (let i = 0; i < 30; i++) doc.addPage();
    await expect(inspectAttachment("자료.pdf", Buffer.from(await doc.save()))).rejects.toThrow("30쪽");
    await expect(inspectAttachment("자료.pdf", Buffer.from("fake"))).rejects.toThrow("PDF");
  });
  it("reads Korean text, rejects binary and excessive text", async () => {
    expect((await inspectAttachment("메모.md", Buffer.from("# 모아이\n참가비 30,000원"))).extracted_text).toContain("30,000원");
    await expect(inspectAttachment("메모.txt", Buffer.from([65, 0, 66]))).rejects.toThrow();
    await expect(inspectAttachment("메모.txt", Buffer.from("가".repeat(200001)))).rejects.toThrow("20만");
  });
  it("extracts Word, slides and HWPX without executing relationships", async () => {
    for (const [ext, path, xml] of [["docx", "word/document.xml", "<w:p><w:t>기획 &amp; 운영</w:t></w:p>"], ["pptx", "ppt/slides/slide1.xml", "<a:p><a:t>기획 &amp; 운영</a:t></a:p>"], ["hwpx", "Contents/section0.xml", "<hp:p><hp:t>기획 &amp; 운영</hp:t></hp:p>"]]) {
      const bytes = Buffer.from(zipSync({ [path]: strToU8(xml), "external.xml": strToU8("https://example.invalid") }));
      const result = await inspectAttachment(`기획.${ext}`, bytes);
      expect(result.extracted_text).toContain("기획 & 운영"); expect(result.extracted_text).not.toContain("example.invalid");
    }
  });
  it("rejects archives with excessive expanded content before extracting text", async () => {
    const bytes = Buffer.from(zipSync({ "word/document.xml": new Uint8Array(31 * 1024 * 1024) }));
    await expect(inspectAttachment("큰문서.docx", bytes)).rejects.toThrow("압축 해제");
  });
  it("reads actual spreadsheet values and all sheet names", async () => {
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["이름", "참가비"], ["점검용", 30000]]), "모아이");
    const result = await inspectAttachment("명단.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
    expect(result.extracted_text).toContain("[시트: 모아이]"); expect(result.extracted_text).toContain("점검용,30000");
  });
});
function clients(row: Record<string, unknown> | null, bytes: Buffer) {
  const chain = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), maybeSingle: vi.fn(async () => ({ data: row })) };
  for (const key of ["select", "eq", "not"] as const) chain[key].mockReturnValue(chain);
  const download = vi.fn(async () => ({ data: new Blob([new Uint8Array(bytes)]) }));
  return { db: { from: () => chain } as unknown as SupabaseClient, admin: { storage: { from: () => ({ download }) } } as unknown as SupabaseClient, chain, download };
}
const id = "10000000-0000-4000-8000-000000000003";
describe("private multimodal model tools", () => {
  it("enforces owner and conversation filters before touching private storage", async () => {
    const c = clients(null, Buffer.from("x"));
    const result = await attachmentTool(c.db, c.admin, "read_attachment", { id }, "owner", "conversation", { bytes: 0, pages: 0 });
    expect(result.ok).toBe(false); expect(c.download).not.toHaveBeenCalled();
    expect(c.chain.eq).toHaveBeenCalledWith("user_id", "owner"); expect(c.chain.eq).toHaveBeenCalledWith("conversation_id", "conversation");
  });
  it("returns a real image block, never a link the model cannot see", async () => {
    const bytes = await png(); const c = clients({ kind: "image", filename: "사진.png", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storage_path: "private" }, bytes);
    const result = await attachmentTool(c.db, c.admin, "read_attachment", { id }, "owner", "conversation", { bytes: 0, pages: 0 });
    expect(result.ok).toBe(true); expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image", source: expect.objectContaining({ type: "base64", media_type: "image/png" }) })]));
    expect(result.summary).not.toContain("base64");
  });
  it("fails on changed originals and prevents oversized visual requests", async () => {
    const c = clients({ kind: "pdf", bytes: 3, pages: 30, sha256: "0".repeat(64) }, Buffer.from("abc"));
    expect((await attachmentTool(c.db, c.admin, "read_attachment", { id }, "o", "c", { bytes: 0, pages: 0 })).ok).toBe(false);
    c.download.mockClear(); expect((await attachmentTool(c.db, c.admin, "read_attachment", { id }, "o", "c", { bytes: 0, pages: 31 })).ok).toBe(false); expect(c.download).not.toHaveBeenCalled();
  });
  it("pages long documents without dropping the remaining content", async () => {
    const c = clients({ kind: "text", filename: "기획.md", extracted_text: "가".repeat(16000) + "마지막" }, Buffer.alloc(0));
    const first = await attachmentTool(c.db, c.admin, "read_attachment", { id }, "o", "c", { bytes: 0, pages: 0 });
    expect(JSON.parse(first.content as string).next_offset).toBe(16000);
    const last = await attachmentTool(c.db, c.admin, "read_attachment", { id, offset: 16000 }, "o", "c", { bytes: 0, pages: 0 });
    expect(JSON.parse(last.content as string).body).toBe("마지막"); expect(c.download).not.toHaveBeenCalled();
  });
});
