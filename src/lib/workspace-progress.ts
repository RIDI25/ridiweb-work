import { isWaiting, isExternalWaiting, waitingSummary, waitingLabel, type WaitingFields } from "@/lib/task-waiting";
import { serviceLabel } from "@/lib/services";
import { taskStatusLabel } from "@/lib/tasks";
import type { Client, ClientService, Task } from "@/types/database";

export type ProgressClient = Pick<Client, "id" | "name" | "is_internal" | "status">;
export type ProgressTask = WaitingFields & Pick<Task, "id" | "title" | "client_id" | "assignee_id" | "due_date" | "status" | "updated_at" | "created_at">;
export type ProgressService = Pick<ClientService, "id" | "client_id" | "service_type" | "status">;
export interface ProgressContent { id: string; client_id: string; title: string | null; approval_status: string; created_at: string; created_by: string | null }
export interface ReviewItem { key: string; clientId: string | null; clientName: string; title: string; kind: string; href: string; updatedAt: string; detail: string }
export interface WaitingItem { id: string; clientName: string; title: string; reason: string; party: string; followup: string | null; overdue: boolean; href: string }
export interface ClientProgress {
  id: string; name: string; isInternal: boolean; clientStatus: string; services: string[];
  stage: string; tone: "review" | "active" | "muted"; openCount: number;
  recent: string | null; recentAt: string | null; stale: boolean;
  next: { title: string; href: string; assignee: string; due: string | null } | null;
  waiting: string;
}
export interface ProgressInput {
  clients: ProgressClient[]; tasks: ProgressTask[]; services: ProgressService[];
  contents: ProgressContent[]; profiles: { id: string; name: string }[]; now: number;
}

export function recordDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "기록일 없음";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function buildWorkspaceProgress({ clients, tasks, services, contents, profiles, now }: ProgressInput): { clients: ClientProgress[]; reviews: ReviewItem[]; waitingItems: WaitingItem[] } {
  const people = new Map(profiles.map((person) => [person.id, person.name]));
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const reviews: ReviewItem[] = [
    ...contents.filter((content) => content.approval_status === "pending").map((content) => ({
      key: `content-${content.id}`, clientId: content.client_id, clientName: names.get(content.client_id) ?? "고객 정보 확인 필요",
      title: content.title || "제목 없는 콘텐츠", kind: "콘텐츠 검수", updatedAt: content.created_at,
      href: `/clients/${content.client_id}/content?view=library&contentId=${content.id}`,
      detail: "콘텐츠 확인 후 승인 또는 수정 요청",
    })),
    ...tasks.filter((task) => task.status === "review" && !isExternalWaiting(task)).map((task) => ({
      key: `task-${task.id}`, clientId: task.client_id, clientName: task.client_id ? names.get(task.client_id) ?? "고객 정보 확인 필요" : "옵티파이 내부",
      title: task.title, kind: "업무 검토", updatedAt: task.updated_at || task.created_at,
      href: `/tasks?taskId=${task.id}`, detail: "작업 결과 확인 후 업무 상태 변경",
    })),
  ].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.key.localeCompare(b.key));

  const today = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  const waitingItems: WaitingItem[] = tasks.filter(isWaiting).sort((a, b) => (a.followup_date ?? "9999").localeCompare(b.followup_date ?? "9999") || a.title.localeCompare(b.title)).map((task) => ({
    id: task.id, clientName: task.client_id ? names.get(task.client_id) ?? "고객 정보 확인 필요" : "옵티파이 내부",
    title: task.title, reason: task.waiting_reason || "대기 사유 확인 필요", party: waitingLabel(task.waiting_on),
    followup: task.followup_date ?? null, overdue: !!task.followup_date && task.followup_date <= today, href: `/tasks?taskId=${task.id}`,
  }));
  return {
    reviews, waitingItems,
    clients: clients.map((client) => {
      const ownTasks = tasks.filter((task) => task.client_id === client.id);
      const ownContents = contents.filter((content) => content.client_id === client.id);
      const pending = reviews.filter((review) => review.clientId === client.id);
      const rejected = ownContents.filter((content) => content.approval_status === "rejected").sort((a, b) => a.created_at.localeCompare(b.created_at));
      const openTasks = ownTasks.filter((task) => task.status !== "done").sort((a, b) => {
        const rank = (task: ProgressTask) => isWaiting(task) ? 2 : task.status === "review" ? 0 : 1;
        return rank(a) - rank(b) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.created_at.localeCompare(b.created_at);
      });
      const records = [
        ...ownTasks.map((task) => ({ title: `${task.title} · ${isWaiting(task) ? waitingLabel(task.waiting_on) : taskStatusLabel(task.status)}`, date: task.updated_at || task.created_at })),
        ...ownContents.map((content) => ({ title: `${content.title || "콘텐츠"} · ${content.approval_status === "rejected" ? "수정 요청" : "검수 대기"}`, date: content.created_at })),
      ].filter((record) => Number.isFinite(Date.parse(record.date))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      const last = records[0];
      const ownWaiting = ownTasks.filter(isWaiting).sort((a, b) => (a.followup_date ?? "9999").localeCompare(b.followup_date ?? "9999"));
      const task = openTasks.find((item) => !isWaiting(item)) ?? ownWaiting[0];
      const content = rejected[0];
      const next = pending[0]
        ? { title: `${pending[0].title} 검토`, href: pending[0].href, assignee: "검토 담당 확인 필요", due: task?.status === "review" && pending[0].key === `task-${task.id}` ? task.due_date : null }
        : content ? { title: `${content.title || "콘텐츠"} 수정`, href: `/clients/${client.id}/content?view=library&contentId=${content.id}`, assignee: people.get(content.created_by ?? "") ?? (content.created_by ? "담당 확인 필요" : "담당 미정"), due: null }
        : task ? { title: isWaiting(task) ? `${task.title} 응답 확인` : task.title, href: `/tasks?taskId=${task.id}`, assignee: people.get(task.assignee_id ?? "") ?? (task.assignee_id ? "담당 확인 필요" : "담당 미정"), due: isWaiting(task) ? task.followup_date ?? null : task.due_date }
        : null;
      return {
        id: client.id, name: client.name, isInternal: client.is_internal, clientStatus: client.status,
        services: services.filter((service) => service.client_id === client.id && service.status === "active").map((service) => serviceLabel(service.service_type)),
        stage: pending.length ? `확인 대기 ${pending.length}건` : rejected.length ? `수정 요청 ${rejected.length}건` : ownWaiting.length && ownWaiting.length === openTasks.length ? `응답·처리 대기 ${ownWaiting.length}건` : openTasks.length ? `진행 업무 ${openTasks.length}건` : "등록된 진행 업무 없음",
        tone: pending.length ? "review" : openTasks.length || rejected.length ? "active" : "muted",
        openCount: openTasks.length, recent: last?.title ?? null, recentAt: last?.date ?? null,
        stale: !!last && now - Date.parse(last.date) >= 7 * 86_400_000,
        next, waiting: ownWaiting.length ? `${waitingSummary(ownWaiting[0])}${ownWaiting.length > 1 ? ` 외 ${ownWaiting.length - 1}건` : ""}` : pending.length ? "내부 검토 대기" : rejected.length ? "콘텐츠 수정 대기" : "별도 대기 기록 없음",
      };
    }),
  };
}
