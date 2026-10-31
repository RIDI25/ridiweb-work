import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { buildWorkspaceProgress, type ProgressClient, type ProgressTask, type ProgressContent, type ProgressService } from "./workspace-progress";

type Database = Awaited<ReturnType<typeof createClient>>;

/** Read existing records only; a failed source must not look like an empty queue. */
export async function loadWorkspaceProgress(supabase: Database) {
  const results = await Promise.all([
    supabase.from("clients").select("id, name, is_internal, status", { count: "exact" }).order("name"),
    supabase.from("tasks").select("*", { count: "exact" }).order("updated_at", { ascending: false }),
    supabase.from("contents").select("id, client_id, title, approval_status, created_at, created_by", { count: "exact" }).in("approval_status", ["pending", "rejected"]).order("created_at", { ascending: false }),
    supabase.from("client_services").select("id, client_id, service_type, status", { count: "exact" }).eq("status", "active").order("created_at"),
    supabase.from("profiles").select("id, name", { count: "exact" }).order("name"),
  ]);
  const labels = ["고객", "업무", "콘텐츠 검수", "진행 계약", "담당자"];
  const warnings = results.flatMap((result, index) => result.error
    ? [`${labels[index]} 정보를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.`]
    : (result.count ?? 0) > (result.data?.length ?? 0) ? [`${labels[index]} 기록이 많아 일부만 표시하고 있습니다. 해당 메뉴에서 전체 기록을 확인해 주세요.`] : []);
  const [clients, tasks, contents, services, profiles] = results;
  const progress = buildWorkspaceProgress({
    clients: (clients.data ?? []) as ProgressClient[], tasks: (tasks.data ?? []) as ProgressTask[],
    contents: (contents.data ?? []) as ProgressContent[], services: (services.data ?? []) as ProgressService[],
    profiles: (profiles.data ?? []) as { id: string; name: string }[], now: Date.now(),
  });
  const incomplete = !!tasks.error || !!contents.error;
  const clientRows = progress.clients.map((client) => ({
    ...client,
    ...(services.error ? { services: ["계약 정보 조회 필요"] } : {}),
    ...(incomplete ? { stage: "진행 정보 조회 필요", tone: "muted" as const, next: null, waiting: "일부 기록을 불러오지 못했습니다." } : {}),
  }));
  return { ...progress, clients: clientRows, warnings, reviewUnavailable: incomplete };
}
