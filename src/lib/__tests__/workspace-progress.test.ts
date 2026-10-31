import { describe, expect, it } from "vitest";
import { buildWorkspaceProgress, type ProgressInput, type ProgressTask } from "../workspace-progress";

const now = Date.parse("2026-11-01T00:00:00Z");
const base: ProgressInput = {
  clients: [{ id: "a", name: "테스트 고객", is_internal: false, status: "active" }],
  profiles: [{ id: "p", name: "담당자" }], contents: [], services: [], tasks: [], now,
};
const task = (changes: Partial<ProgressTask> = {}): ProgressTask => ({
  id: "task", title: "반영 결과 확인", client_id: "a", assignee_id: "p", due_date: null, status: "todo",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-31T00:00:00Z", ...changes,
});

describe("workspace progress", () => {
  it("includes reviews without a due date and keeps unlinked internal work in the inbox", () => {
    const result = buildWorkspaceProgress({ ...base, tasks: [task({ status: "review", client_id: null })] });
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({ clientName: "옵티파이 내부", href: "/tasks?taskId=task" });
    expect(result.clients[0].next).toBeNull();
  });
  it("keeps rejected content out of the review inbox and assigns its next action to the creator", () => {
    const result = buildWorkspaceProgress({ ...base, contents: [{ id: "c", client_id: "a", title: "초안", approval_status: "rejected", created_by: "p", created_at: "2026-10-31T00:00:00Z" }] });
    expect(result.reviews).toHaveLength(0);
    expect(result.clients[0].next).toMatchObject({ title: "초안 수정", assignee: "담당자" });
  });
  it("does not infer delivery or client approval from a completed task", () => {
    const client = buildWorkspaceProgress({ ...base, tasks: [task({ status: "done" })] }).clients[0];
    expect(client.next).toBeNull();
    expect(client.stage).toBe("등록된 진행 업무 없음");
    expect(client.recent).toBe("반영 결과 확인 · 완료");
    expect(client.waiting).toBe("별도 대기 기록 없음");
  });
  it("prefers a review to future work and does not treat the executor as the reviewer", () => {
    const result = buildWorkspaceProgress({ ...base, tasks: [task({ id: "future", due_date: "2026-11-02" }), task({ status: "review", due_date: "2026-11-10" })] });
    expect(result.clients[0].next).toMatchObject({ href: "/tasks?taskId=task", assignee: "검토 담당 확인 필요", due: "2026-11-10" });
  });
  it("keeps multiple active contracts and marks stale evidence without inventing a status", () => {
    const result = buildWorkspaceProgress({ ...base, tasks: [task({ updated_at: "2026-10-01T00:00:00Z" })], services: [
      { id: "s1", client_id: "a", service_type: "site_build", status: "active" },
      { id: "s2", client_id: "a", service_type: "geo_content", status: "active" },
      { id: "s3", client_id: "a", service_type: "naver_manage", status: "ended" },
    ] });
    expect(result.clients[0].services).toHaveLength(2);
    expect(result.clients[0].stale).toBe(true);
    expect(result.clients[0].stage).toBe("진행 업무 1건");
  });
  it("sorts dated open work before undated work without mutating source records", () => {
    const tasks = [task({ id: "undated" }), task({ id: "dated", due_date: "2026-11-02" })];
    const result = buildWorkspaceProgress({ ...base, tasks });
    expect(result.clients[0].next?.href).toBe("/tasks?taskId=dated");
    expect(tasks.map((item) => item.id)).toEqual(["undated", "dated"]);
  });
});

describe("waiting progress", () => {
  it("separates external waiting from internal reviews and points to follow-up", () => {
    const result = buildWorkspaceProgress({ ...base, tasks: [task({ status: "review", waiting_on: "vendor", waiting_reason: "유지보수사 반영 회신", followup_date: "2026-11-01" })] });
    expect(result.reviews).toHaveLength(0);
    expect(result.waitingItems).toHaveLength(1);
    expect(result.waitingItems[0]).toMatchObject({ reason: "유지보수사 반영 회신", overdue: true });
    expect(result.clients[0].next).toMatchObject({ title: "반영 결과 확인 응답 확인", due: "2026-11-01" });
    expect(result.clients[0].waiting).toContain("유지보수사 반영 회신");
  });
  it("prioritizes available work and does not count old waiting fields on done work", () => {
    const result = buildWorkspaceProgress({ ...base, tasks: [task({ id: "waiting", waiting_on: "client", waiting_reason: "자료 회신", followup_date: "2026-11-10" }), task({ id: "available", due_date: "2026-11-03" }), task({ id: "done", status: "done", waiting_on: "vendor" })] });
    expect(result.clients[0].next?.href).toBe("/tasks?taskId=available");
    expect(result.waitingItems).toHaveLength(1);
  });
  it("orders follow-ups before undated waiting and preserves unlinked internal work", () => {
    const result = buildWorkspaceProgress({ ...base, tasks: [task({ id: "later", waiting_on: "client" }), task({ id: "now", client_id: null, waiting_on: "internal", followup_date: "2026-10-31" })] });
    expect(result.waitingItems.map((item) => item.id)).toEqual(["now", "later"]);
    expect(result.waitingItems[0].clientName).toBe("옵티파이 내부");
    expect(result.waitingItems[1].reason).toBe("대기 사유 확인 필요");
  });
});
