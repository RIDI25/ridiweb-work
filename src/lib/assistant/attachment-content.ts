import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { fileSpec } from "./attachments";

const MAX_TEXT = 200_000, MAX_EXPANDED = 30 * 1024 * 1024;
function decode(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("euc-kr", { fatal: true }).decode(bytes); }
}
function xmlText(xml: string) {
  return xml.replace(/<\/(?:w:p|a:p|hp:p|w:tr)>/g, "\n").replace(/<(?:w:tab|hp:tab)\b[^>]*\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex, dec, named) => {
    if (hex || dec) { const point = parseInt(hex || dec, hex ? 16 : 10); return point <= 0x10ffff ? String.fromCodePoint(point) : ""; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string,string>)[String(named).toLowerCase()];
  });
}
export async function inspectAttachment(filename: string, bytes: Buffer) {
  const spec = fileSpec(filename, bytes.length);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let text = "", pages: number | null = null, note = "";
  if (spec.kind === "image") {
    const image = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    const expected = spec.ext === "jpg" ? "jpeg" : spec.ext;
    if (image.format !== expected || !image.width || !image.height || image.width > 16000 || image.height > 16000) throw new Error("이미지 형식·크기를 확인해 주세요. PNG·JPG·WebP·GIF로 다시 저장해 주세요.");
    note = (image.pages || 1) > 1 ? "움직이는 이미지는 첫 장을 참고합니다." : "";
  } else if (spec.kind === "pdf") {
    if (!bytes.subarray(0,1024).includes(Buffer.from("%PDF-"))) throw new Error("올바른 PDF 파일이 아니에요.");
    let pdf;
    try { pdf = await PDFDocument.load(bytes); } catch { throw new Error("PDF를 읽지 못했어요. 암호를 해제하거나 PDF로 다시 저장해 주세요."); }
    pages = pdf.getPageCount();
    if (pages < 1 || pages > 30) throw new Error("PDF는 파일당 30쪽까지 지원해요. 나누어 첨부해 주세요.");
  } else if (["docx","xlsx","pptx","hwpx"].includes(spec.ext)) {
    if (bytes.readUInt16LE(0) !== 0x4b50) throw new Error("문서 형식과 확장자가 맞지 않아요.");
    let expanded = 0, entries = 0;
    // Inspect sizes before decompression; no macros, relationships or external URLs are executed.
    unzipSync(bytes, { filter: f => { expanded += f.originalSize; if (++entries > 3000 || expanded > MAX_EXPANDED) throw new Error("압축 해제한 문서가 너무 커요. PDF나 작은 문서로 나누어 주세요."); return false; } });
    if (spec.ext === "xlsx") text = workbookText(bytes);
    else {
      const files = unzipSync(bytes, { filter: f => spec.ext === "docx" ? /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(f.name) : spec.ext === "pptx" ? /^ppt\/slides\/slide\d+\.xml$/.test(f.name) : /^Contents\/section\d+\.xml$/.test(f.name) });
      const names = Object.keys(files).sort((a,b) => a.localeCompare(b, "en", { numeric: true }));
      if (!names.length) throw new Error("문서 본문을 찾지 못했어요. PDF로 변환해 주세요.");
      text = names.map((name,i) => `${spec.ext === "pptx" ? `\n[슬라이드 ${i+1}]\n` : ""}${xmlText(decode(files[name]))}`).join("\n");
      note = "문서의 텍스트를 읽습니다. 배치·사진·도표 확인이 필요하면 PDF로 첨부해 주세요.";
    }
  } else if (spec.ext === "xls") {
    if (bytes.subarray(0,8).toString("hex") !== "d0cf11e0a1b11ae1") throw new Error("올바른 XLS 파일이 아니에요. XLSX나 CSV로 다시 저장해 주세요.");
    text = workbookText(bytes);
  } else { text = decode(bytes); if (text.includes("\0")) throw new Error("텍스트 파일을 읽지 못했어요. UTF-8로 저장해 주세요."); }
  if (spec.kind === "text" && (!text.trim() || text.length > MAX_TEXT)) throw new Error(text.trim() ? "문서 내용은 20만 자까지 지원해요. 파일을 나누어 주세요." : "읽을 수 있는 텍스트가 없어요. 이미지나 PDF로 첨부해 주세요.");
  return { ...spec, sha256, extracted_text: text, pages, note };
}
function workbookText(bytes: Buffer) {
  const book = XLSX.read(bytes, { type: "buffer", dense: true, sheetRows: 5001, cellHTML: false, cellFormula: false, bookVBA: false });
  if (book.SheetNames.length > 30) throw new Error("시트는 파일당 30개까지 지원해요.");
  const parts: string[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name], range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
    if (range.e.r >= 5000 || range.e.c >= 100) throw new Error("시트는 5,000행·100열까지 지원해요. 필요한 범위를 나누어 주세요.");
    parts.push(`[시트: ${name}]\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return parts.join("\n\n");
}
export async function imageForModel(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).png().toBuffer();
}
