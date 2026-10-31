"use client";

/**
 * 고객사 기본정보 섹션 모음 — 고객사 카드의 기본정보 탭과 설정 화면이 같이 쓴다.
 * (2026-09-06 settings-view.tsx 에서 분리. 동작은 그대로)
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CHANNELS, channelLabel } from "@/lib/channels";
import {
  deleteClient,
  saveClient,
  saveChannelAssignee,
  saveChannelConnection,
  revealChannelPassword,
  saveWpConnection,
} from "@/lib/actions/settings";
import {
  ensureOnboardingTasks,
  getOnboardingSignals,
  toggleOnboardingTask,
} from "@/lib/actions/onboarding";
import { DEFAULT_ONBOARDING_TASKS, autoDoneKeys } from "@/lib/onboarding";
import type { Client, ChannelSettings, Profile } from "@/types/database";

interface OnboardingTask {
  id: string;
  task_key: string;
  label: string;
  done: boolean;
}

export function ClientCard({
  client,
  readOnly,
  onSaved,
}: {
  client: Client;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [gsc, setGsc] = useState(client.gsc_site_url ?? "");
  const [ga4, setGa4] = useState(client.ga4_property_id ?? "");
  const [status, setStatus] = useState(client.status);
  const hasKind = "kind" in client; // 0032
  const [kind, setKind] = useState<"client" | "partner">(client.kind === "partner" ? "partner" : "client");
  const [memo, setMemo] = useState(client.memo ?? "");
  const [msg, setMsg] = useState("");
  // 0028 회사 정보 — 컬럼이 있는 DB 에서만 저장한다 (없으면 칸도 숨김)
  const hasCompanyCols = "industry" in client;
  const [company, setCompany] = useState({
    industry: client.industry ?? "",
    region: client.region ?? "",
    website_url: client.website_url ?? "",
    blog_url: client.blog_url ?? "",
    place_url: client.place_url ?? "",
    contact_name: client.contact_name ?? "",
    contact_phone: client.contact_phone ?? "",
  });
  const setCo = (k: keyof typeof company) => (v: string) => setCompany((c) => ({ ...c, [k]: v }));

  async function save() {
    const r = await saveClient(client.id, {
      name,
      gsc_site_url: gsc || null,
      ga4_property_id: ga4 || null,
      status,
      ...(hasKind ? { kind } : {}),
      memo: memo || null,
      ...(hasCompanyCols
        ? Object.fromEntries(Object.entries(company).map(([k, v]) => [k, v.trim() || null]))
        : {}),
    });
    setMsg(r.ok ? "저장됨" : `실패: ${r.error}`);
    setTimeout(() => setMsg(""), 2000);
    if (r.ok) onSaved();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold outline-none focus:border-accent-deep disabled:bg-subtle"
        />
        {client.is_internal && (
          <span className="rounded bg-tint px-2 py-0.5 text-xs text-accent-deep">
            내부
          </span>
        )}
      </div>
      {!client.is_internal && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted">구분</span>
          {hasKind ? (
            <div className="flex rounded-md border border-border bg-subtle p-0.5">
              {(["client", "partner"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setKind(k)}
                  className={["rounded px-4 py-1 text-sm", kind === k ? "bg-surface font-semibold text-accent-deep shadow-sm" : "text-muted hover:text-ink"].join(" ")}
                >
                  {k === "client" ? "고객사" : "협력사"}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted">0032_client_kind.sql 을 실행하면 고객사/협력사를 고를 수 있습니다.</span>
          )}
          {hasKind && kind !== (client.kind === "partner" ? "partner" : "client") && <span className="text-xs text-amber-700">아래 저장을 눌러야 반영됩니다</span>}
        </div>
      )}
      {hasCompanyCols ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="업종 (자유 입력)" value={company.industry} onChange={setCo("industry")} disabled={readOnly} />
          <Field label="지역" value={company.region} onChange={setCo("region")} disabled={readOnly} />
          <Field label="홈페이지" value={company.website_url} onChange={setCo("website_url")} disabled={readOnly} />
          <Field label="네이버 블로그" value={company.blog_url} onChange={setCo("blog_url")} disabled={readOnly} />
          <Field label="네이버 플레이스" value={company.place_url} onChange={setCo("place_url")} disabled={readOnly} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="고객 담당자" value={company.contact_name} onChange={setCo("contact_name")} disabled={readOnly} />
            <Field label="연락처" value={company.contact_phone} onChange={setCo("contact_phone")} disabled={readOnly} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">업종·지역·홈페이지·블로그·플레이스 칸은 0028_client_brief.sql 을 실행하면 나타납니다.</p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="GSC 사이트 URL (sc-domain:… 또는 https://…)" value={gsc} onChange={setGsc} disabled={readOnly} />
        <Field label="GA4 속성 ID (숫자)" value={ga4} onChange={setGa4} disabled={readOnly} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted">상태</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Client["status"])}
            disabled={readOnly}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm disabled:bg-subtle"
          >
            <option value="active">진행</option>
            <option value="paused">중지</option>
            <option value="ended">종료</option>
          </select>
        </div>

      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">메모</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={readOnly}
          rows={4}
          placeholder="고객사 관련 메모 — 소통 내역, 특이사항, 요청사항 등"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep disabled:bg-subtle"
        />
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-ink hover:opacity-90"
          >
            저장
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      )}

      {!client.is_internal && (
        <OnboardingChecklist clientId={client.id} readOnly={readOnly} />
      )}
    </div>
  );
}

/** 고객사 삭제 — 이름 재입력 확인 후 실행. owner 전용, 내부 클라이언트 제외 */
export function DangerZone({
  client,
  onDeleted,
}: {
  client: Client;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function remove() {
    const typed = prompt(
      `정말 삭제하려면 고객사 이름을 그대로 입력하세요: ${client.name}\n\n프리셋·키워드·플랜·콘텐츠·리포트·온보딩·계약 정보가 함께 삭제되며 되돌릴 수 없습니다.`,
    );
    if (typed == null) return;
    if (typed.trim() !== client.name) {
      setMsg("이름이 일치하지 않아 취소했습니다.");
      return;
    }
    setBusy(true);
    setMsg("");
    const r = await deleteClient(client.id);
    setBusy(false);
    if (!r.ok) {
      setMsg(`삭제 실패: ${r.error}`);
      return;
    }
    onDeleted();
  }

  return (
    <section className="rounded-lg border border-red-200 bg-red-50/50 p-4">
      <h2 className="text-sm font-bold text-red-600">고객사 삭제</h2>
      <p className="mt-1 text-xs text-muted">
        이 고객사와 프리셋·키워드·플랜·콘텐츠·리포트·온보딩·계약 정보가 함께
        삭제됩니다. 업무·일정·리드·API 사용량 로그는 남고 이 고객사와의 연결만
        해제됩니다. 되돌릴 수 없습니다.
      </p>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      <button
        onClick={remove}
        disabled={busy}
        className="mt-3 rounded-md border border-red-300 bg-surface px-4 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
      >
        {busy ? "삭제 중…" : "이 고객사 삭제"}
      </button>
    </section>
  );
}

export function OnboardingChecklist({
  clientId,
  readOnly,
}: {
  clientId: string;
  readOnly: boolean;
}) {
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [autoDone, setAutoDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    async function load() {
      if (!readOnly) await ensureOnboardingTasks(clientId);
      const supabase = createClient();
      const [{ data: rows }, signals] = await Promise.all([
        supabase
          .from("client_onboarding_tasks")
          .select("id, task_key, label, done")
          .eq("client_id", clientId),
        getOnboardingSignals(clientId),
      ]);
      if (!active) return;
      setTasks((rows ?? []) as OnboardingTask[]);
      setAutoDone(autoDoneKeys(signals));
    }
    void load();
    return () => {
      active = false;
    };
  }, [clientId, readOnly]);

  async function toggle(t: OnboardingTask) {
    const next = !t.done;
    setTasks((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, done: next } : x)),
    );
    await toggleOnboardingTask(t.id, next);
  }

  const ordered = DEFAULT_ONBOARDING_TASKS.map((d) =>
    tasks.find((t) => t.task_key === d.key),
  ).filter((t): t is OnboardingTask => !!t);
  const remaining = ordered.filter(
    (t) => !t.done && !autoDone.has(t.task_key),
  ).length;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">온보딩 체크리스트</h4>
        <span className="text-xs text-muted">미완료 {remaining}건</span>
      </div>
      <ul className="space-y-1.5">
        {ordered.map((t) => {
          const auto = autoDone.has(t.task_key);
          const done = t.done || auto;
          return (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={done}
                disabled={readOnly || auto}
                onChange={() => toggle(t)}
              />
              <span className={done ? "text-muted line-through" : "text-ink"}>
                {t.label}
              </span>
              {auto && <span className="text-xs text-accent-deep">(자동)</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 채널 계정·기본 담당자 — 채널을 고르면 로그인 정보 공유와
 * 플랜 자동 배정용 기본 담당자를 관리한다. */
export function ChannelAccountsSection({
  clientId,
  profiles,
  readOnly,
}: {
  clientId: string;
  profiles: Profile[];
  readOnly: boolean;
}) {
  const [channel, setChannel] = useState(CHANNELS[0]?.key ?? "");
  const [settings, setSettings] = useState<ChannelSettings[]>([]);
  const [assigneeMsg, setAssigneeMsg] = useState("");

  // 상태 반영은 .then 콜백 안에서 한다 — effect 가 load() 를 직접 불러도 동기 setState 가 되지 않게.
  function load() {
    return createClient()
      .from("channel_settings")
      .select("id, channel, default_assignee")
      .eq("client_id", clientId)
      .then(({ data }) => setSettings((data ?? []) as ChannelSettings[]));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const currentAssignee =
    settings.find((s) => s.channel === channel)?.default_assignee ?? "";

  async function changeAssignee(value: string) {
    const assignee = value || null;
    setSettings((prev) =>
      prev.map((s) =>
        s.channel === channel ? { ...s, default_assignee: assignee } : s,
      ),
    );
    const r = await saveChannelAssignee(clientId, channel, assignee);
    if (r.ok) await load(); // 미등록 채널이면 upsert로 행이 생성된다
    setAssigneeMsg(r.ok ? "기본 담당자 저장됨" : `실패: ${r.error}`);
    setTimeout(() => setAssigneeMsg(""), 2000);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChannel(c.key)}
            className={[
              "rounded-md border px-3 py-1.5 text-sm font-medium",
              channel === c.key
                ? "border-accent-deep bg-tint text-accent-deep"
                : "border-border text-muted hover:text-ink",
            ].join(" ")}
          >
            {channelLabel(c.key)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-muted">
          이 채널 기본 담당자 (플랜 자동 배정)
        </label>
        <select
          value={currentAssignee}
          onChange={(e) => changeAssignee(e.target.value)}
          disabled={readOnly}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm disabled:bg-subtle"
        >
          <option value="">미지정</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {assigneeMsg && <span className="text-xs text-muted">{assigneeMsg}</span>}
      </div>
      <ChannelConnection cid={clientId} channel={channel} readOnly={readOnly} />
    </div>
  );
}

/** 채널 계정/연결 정보 — 아이디·비밀번호(암호화)·주소·카테고리.
 * 네이버 블로그처럼 수동 발행하는 채널의 로그인 정보를 팀이 공유한다. */
export function ChannelConnection({
  cid,
  channel,
  readOnly,
}: {
  cid: string;
  channel: string;
  readOnly: boolean;
}) {
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [channelUrl, setChannelUrl] = useState("");
  // 카테고리(게시판)는 여러 개 — 태그로 관리, DB에는 쉼표 구분 문자열로 저장
  const [categories, setCategories] = useState<string[]>([]);
  const [catInput, setCatInput] = useState("");
  const [msg, setMsg] = useState("");
  const [needsMigration, setNeedsMigration] = useState(false);

  const isNaver = channel.startsWith("naver");
  const idLabel = isNaver ? "네이버 아이디" : "계정 아이디";
  const urlLabel =
    channel === "naver_blog"
      ? "블로그 주소"
      : channel === "naver_place"
        ? "플레이스 주소"
        : "채널 주소";

  // 고객사·채널이 바뀌면 임시 상태(안내 메시지·비밀번호 입력·표시된 비밀번호)를 비운다.
  // effect 안 동기 setState 대신 '마지막으로 적용한 키'를 기억해 렌더 중에 반영한다 (React 의 이전 렌더 정보 저장 패턴).
  const connKey = `${cid}|${channel}`;
  const [appliedConnKey, setAppliedConnKey] = useState(connKey);
  if (appliedConnKey !== connKey) {
    setAppliedConnKey(connKey);
    if (cid && channel) {
      setMsg("");
      setShownPassword(null);
      setPassword("");
    }
  }

  useEffect(() => {
    if (!cid || !channel) return;
    createClient()
      .from("channel_settings")
      .select("account_id, channel_url, category, account_password_encrypted")
      .eq("client_id", cid)
      .eq("channel", channel)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          // 0020 마이그레이션 전이면 컬럼이 없어 조회 실패 — 안내만 하고 프리셋 편집은 유지
          setNeedsMigration(true);
          return;
        }
        setNeedsMigration(false);
        setAccountId(data?.account_id ?? "");
        setChannelUrl(data?.channel_url ?? "");
        setCategories(
          (data?.category ?? "")
            .split(/[,\n]/)
            .map((s: string) => s.trim())
            .filter(Boolean),
        );
        setCatInput("");
        setHasPassword(!!data?.account_password_encrypted);
      });
  }, [cid, channel]);

  function addCategory() {
    const v = catInput.trim();
    if (!v) return;
    setCategories((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setCatInput("");
  }

  async function save() {
    // 입력창에 치고 [추가]를 안 누른 값도 저장에 포함
    const pending = catInput.trim();
    const finalCategories =
      pending && !categories.includes(pending)
        ? [...categories, pending]
        : categories;
    if (pending) {
      setCategories(finalCategories);
      setCatInput("");
    }
    const r = await saveChannelConnection(cid, channel, {
      accountId,
      password: password || undefined,
      channelUrl,
      category: finalCategories.join(", "),
    });
    if (r.ok) {
      if (password) setHasPassword(true);
      setPassword("");
      setMsg("계정 정보 저장됨");
    } else {
      setMsg(`실패: ${r.error}`);
    }
    setTimeout(() => setMsg(""), 3500);
  }

  async function reveal() {
    if (shownPassword !== null) {
      setShownPassword(null);
      return;
    }
    const r = await revealChannelPassword(cid, channel);
    if (r.ok && r.password) setShownPassword(r.password);
    else {
      setMsg(r.error ?? "조회 실패");
      setTimeout(() => setMsg(""), 2500);
    }
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        채널 계정 정보를 쓰려면 <b>supabase/migrations/0020_channel_connection.sql</b>을
        Supabase SQL Editor에서 한 번 실행해 주세요.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">
        채널 계정 정보 — {channelLabel(channel)}
      </h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">{idLabel}</span>
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={readOnly}
            placeholder="예: optify_partner"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep disabled:bg-subtle"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">
            비밀번호 {hasPassword && "(저장됨 — 변경 시에만 입력)"}
          </span>
          <div className="flex gap-1.5">
            <input
              type={shownPassword !== null ? "text" : "password"}
              value={shownPassword ?? password}
              onChange={(e) => {
                setShownPassword(null);
                setPassword(e.target.value);
              }}
              disabled={readOnly && shownPassword === null}
              placeholder={hasPassword ? "••••••••" : "비밀번호 입력"}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep disabled:bg-subtle"
            />
            {hasPassword && (
              <button
                onClick={reveal}
                type="button"
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-subtle"
              >
                {shownPassword !== null ? "숨기기" : "보기"}
              </button>
            )}
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">{urlLabel}</span>
          <input
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            disabled={readOnly}
            placeholder="https://blog.naver.com/…"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep disabled:bg-subtle"
          />
        </label>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted">
            카테고리 (글 올릴 게시판 — 여러 개 등록 가능)
          </span>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {categories.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-full bg-tint px-2.5 py-1 text-xs font-medium text-accent-deep"
                >
                  {c}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        setCategories((prev) => prev.filter((x) => x !== c))
                      }
                      className="text-accent-deep/60 hover:text-accent-deep"
                      aria-label={`${c} 삭제`}
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {!readOnly && (
            <div className="flex gap-1.5">
              <input
                value={catInput}
                onChange={(e) => setCatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addCategory();
                  }
                }}
                placeholder="예: 인테리어 정보 — 입력 후 Enter 또는 [추가]"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep"
              />
              <button
                type="button"
                onClick={addCategory}
                className="shrink-0 rounded-md border border-border px-3 py-1 text-sm text-muted hover:bg-subtle"
              >
                추가
              </button>
            </div>
          )}
        </div>
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            className="rounded-md bg-accent-deep px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            계정 정보 저장
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      )}
      <p className="text-[11px] text-muted">
        비밀번호는 암호화되어 저장되고, [보기]를 눌렀을 때만 서버에서 복호화해
        보여줍니다.
      </p>
    </div>
  );
}

export function WordpressTab({ clients, readOnly }: { clients: Client[]; readOnly: boolean }) {
  const [clientId, setClientId] = useState("");
  const [wpUrl, setWpUrl] = useState("");
  const [wpUsername, setWpUsername] = useState("");
  const [wpPassword, setWpPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const cid = clientId || clients[0]?.id || "";

  useEffect(() => {
    if (!cid) return;
    createClient()
      .from("channel_settings")
      .select("wp_url, wp_username")
      .eq("client_id", cid)
      .eq("channel", "wordpress")
      .maybeSingle()
      .then(({ data }) => {
        setWpUrl(data?.wp_url ?? "");
        setWpUsername(data?.wp_username ?? "");
        setWpPassword("");
      });
  }, [cid]);

  async function test() {
    setTestMsg("테스트 중…");
    const res = await fetch("/api/wordpress/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        wpPassword
          ? { wpUrl, wpUsername, wpPassword }
          : { clientId: cid },
      ),
    });
    const d = await res.json();
    setTestMsg(d.ok ? `연결 성공 (${d.name ?? "OK"})` : `실패: ${d.error}`);
  }

  async function save() {
    const r = await saveWpConnection(cid, {
      wpUrl,
      wpUsername,
      wpPassword: wpPassword || undefined,
    });
    setMsg(r.ok ? "저장됨" : `실패: ${r.error}`);
    setTimeout(() => setMsg(""), 2000);
  }

  return (
    <div className="max-w-lg space-y-3">
      <select
        value={cid}
        onChange={(e) => setClientId(e.target.value)}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Field label="사이트 URL (https://example.com)" value={wpUrl} onChange={setWpUrl} disabled={readOnly} />
      <Field label="사용자명" value={wpUsername} onChange={setWpUsername} disabled={readOnly} />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">
          Application Password (변경 시에만 입력, 비우면 유지)
        </label>
        <input
          type="password"
          value={wpPassword}
          onChange={(e) => setWpPassword(e.target.value)}
          disabled={readOnly}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep disabled:bg-subtle"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={test}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-subtle"
        >
          연결 테스트
        </button>
        {!readOnly && (
          <button
            onClick={save}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-ink hover:opacity-90"
          >
            저장
          </button>
        )}
        {testMsg && <span className="text-xs text-muted">{testMsg}</span>}
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-deep disabled:bg-subtle"
      />
    </div>
  );
}
