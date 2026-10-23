"use client";

import { useEffect, useRef, useState } from "react";

type BizFile = { url: string | null; type: string; uploadedAt: string | null; size: number | null };

/**
 * 사업자등록증 — 올리면 바로 미리보기 (이미지는 그림, PDF 는 문서 보기). 한 장만 보관, 새로 올리면 바뀐다.
 * 저장은 /api/clients/[id]/biz-reg (비공개 Storage, 10분짜리 링크).
 */
export function BizRegCard({ clientId }: { clientId: string }) {
  const [state, setState] = useState<{ id: string; file: BizFile | null; error?: string } | null>(null);
  const [local, setLocal] = useState<{ url: string; type: string } | null>(null); // 올리는 중 미리보기
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/clients/${clientId}/biz-reg`)
      .then((r) => r.json())
      .then((d) => alive && setState({ id: clientId, file: d.ok ? d.file : null, error: d.ok ? undefined : d.error }))
      .catch(() => alive && setState({ id: clientId, file: null, error: "불러오지 못했습니다" }));
    return () => {
      alive = false;
    };
  }, [clientId, tick]);

  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local.url);
  }, [local]);

  async function upload(f: File) {
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) return setMsg("JPG·PNG·WEBP·PDF 파일만 올릴 수 있습니다.");
    if (f.size > 4 * 1024 * 1024) return setMsg("4MB 이하 파일만 올릴 수 있습니다. 사진이면 해상도를 줄여 주세요.");
    setLocal({ url: URL.createObjectURL(f), type: f.type });
    setBusy(true);
    setMsg("");
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(`/api/clients/${clientId}/biz-reg`, { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: "업로드 실패" }));
    setBusy(false);
    if (!r.ok) {
      setLocal(null);
      return setMsg(r.error ?? "업로드 실패");
    }
    setMsg("저장했습니다.");
    setTick((n) => n + 1);
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/clients/${clientId}/biz-reg`, { method: "DELETE" });
    setBusy(false);
    setLocal(null);
    setMsg("삭제했습니다.");
    setTick((n) => n + 1);
  }

  const cur = state?.id === clientId ? state : null;
  const shown = local ?? (cur?.file?.url ? { url: cur.file.url, type: cur.file.type } : null);
  const isPdf = shown?.type === "application/pdf";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          JPG·PNG·PDF, 4MB 이하. 한 장만 보관하며 새로 올리면 바뀝니다.
          {cur?.file?.uploadedAt && ` · ${new Date(cur.file.uploadedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 올림`}
        </p>
        <span className="flex items-center gap-2">
          {shown && !busy && (
            <a href={shown.url} target="_blank" rel="noreferrer" className="text-xs text-accent-deep hover:underline">
              새 창에서 크게 보기
            </a>
          )}
          {cur?.file && (
            <button onClick={remove} disabled={busy} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-red-600 disabled:opacity-50">
              삭제
            </button>
          )}
          <button onClick={() => input.current?.click()} disabled={busy} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "올리는 중…" : cur?.file ? "다시 올리기" : "사업자등록증 올리기"}
          </button>
        </span>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </div>
      {msg && <p className="mb-2 text-xs text-muted">{msg}</p>}
      {!cur && !local ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : shown ? (
        <div className="overflow-hidden rounded-md border border-border bg-subtle">
          {isPdf ? (
            <iframe src={shown.url} title="사업자등록증" className="h-[520px] w-full bg-white" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- 서명 URL·로컬 미리보기라 next/image 최적화 대상이 아니다
            <img src={shown.url} alt="사업자등록증" className="mx-auto max-h-[520px] w-auto object-contain" />
          )}
        </div>
      ) : (
        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void upload(f);
          }}
          className="flex h-40 w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-sm text-muted hover:border-accent/50 hover:bg-tint/30"
        >
          <span className="text-2xl">📄</span>
          <span>사업자등록증을 끌어다 놓거나 눌러서 올리세요</span>
          {cur?.error && <span className="text-xs text-red-600">{cur.error}</span>}
        </button>
      )}
    </div>
  );
}
