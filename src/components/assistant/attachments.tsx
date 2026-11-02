"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ATTACHMENT_BUCKET, MAX_ATTACHMENTS, MAX_MESSAGE_FILE_BYTES, fileSpec, fileSize, type ChatAttachment } from "@/lib/assistant/attachments";
import styles from "./assistant-widget.module.css";

interface DraftFile { id: string; file: File; preview?: string }
async function request(body: Record<string, unknown>) {
  const response = await fetch("/api/assistant/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "파일을 준비하지 못했어요.");
  return data;
}
export function useAttachments(onError: (message: string) => void) {
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [progress, setProgress] = useState("");
  const urls = useRef(new Set<string>());
  useEffect(() => { const allocated = urls.current; return () => { for (const url of allocated) URL.revokeObjectURL(url); }; }, []);
  function add(incoming: File[]) {
    if (!incoming.length) return;
    try {
      if (files.length + incoming.length > MAX_ATTACHMENTS) throw new Error("한 번에 파일 5개까지 첨부할 수 있어요.");
      if ([...files.map(item => item.file), ...incoming].reduce((sum, file) => sum + file.size, 0) > MAX_MESSAGE_FILE_BYTES) throw new Error("첨부파일 합계는 20MB까지 가능해요.");
      const valid = incoming.map(file => ({ file, spec: fileSpec(file.name, file.size) }));
      const additions = valid.map(({ file, spec }) => {
        const preview = spec.kind === "image" ? URL.createObjectURL(file) : undefined;
        if (preview) urls.current.add(preview);
        return { id: crypto.randomUUID(), file, preview };
      });
      setFiles([...files, ...additions]); onError("");
    } catch (e) { onError((e as Error).message); }
  }
  function remove(id: string) {
    const file = files.find(item => item.id === id);
    if (file?.preview) { URL.revokeObjectURL(file.preview); urls.current.delete(file.preview); }
    setFiles(previous => previous.filter(item => item.id !== id));
  }
  function clear() { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); setFiles([]); }
  async function upload(conversationId: string) {
    try {
      for (const [index, item] of files.entries()) {
        setProgress(`파일 준비 중 ${index + 1}/${files.length} · ${item.file.name}`);
        const init = await request({ operation: "init", id: item.id, conversationId, filename: item.file.name, bytes: item.file.size });
        if (!init.ready) {
          const { error } = await createClient().storage.from(ATTACHMENT_BUCKET).uploadToSignedUrl(init.path, init.token, item.file, { contentType: init.mime });
          // A response can be lost after storage accepts a file. Complete verifies the immutable original on retry.
          if (error && String(error.statusCode) !== "409" && !/already exists|duplicate/i.test(error.message)) throw new Error(`${item.file.name}: 업로드가 끊겼어요. 다시 보내기를 눌러 주세요.`);
          await request({ operation: "complete", id: item.id });
        }
      }
      return files.map(item => item.id);
    } finally { setProgress(""); }
  }
  return { files, progress, add, remove, clear, upload };
}
export function DraftAttachments({ files, disabled, remove }: { files: DraftFile[]; disabled: boolean; remove: (id: string) => void }) {
  if (!files.length) return null;
  return <ul className={styles.attachments} aria-label="보낼 첨부파일">{files.map(item => <li key={item.id} className={styles.attachment}>
    {/* Private local previews do not use the public image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {item.preview ? <img src={item.preview} alt="" /> : <span className={styles.fileIcon} aria-hidden>↥</span>}
    <span className={styles.fileName}>{item.file.name}<small>{fileSize(item.file.size)}</small></span>
    <button type="button" disabled={disabled} onClick={() => remove(item.id)} aria-label={`${item.file.name} 첨부 취소`}>×</button>
  </li>)}</ul>;
}
export function SavedAttachments({ files }: { files?: ChatAttachment[] }) {
  if (!files?.length) return null;
  return <ul className={styles.attachments} aria-label="저장된 첨부파일">{files.map(file => <li key={file.id}>
    <a className={styles.attachment} href={`/api/assistant/attachments?id=${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer" title={file.note || "원본 다운로드"}>
      {/* Signed private images require an authenticated, uncached URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {file.kind === "image" ? <img src={`/api/assistant/attachments?id=${encodeURIComponent(file.id)}&preview=1`} loading="lazy" alt={file.filename} /> : <span className={styles.fileIcon} aria-hidden>↓</span>}
      <span className={styles.fileName}>{file.filename}<small>{fileSize(file.bytes)}{file.pages ? ` · ${file.pages}쪽` : ""} · 원본</small></span>
    </a>
  </li>)}</ul>;
}
