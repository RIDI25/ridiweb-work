import { describe, it, expect } from "vitest";
import { meetingInput, meetingMarkdown, noteExcerpt } from "../notes";
describe("meeting notes", () => {
  it("validates dates, title and customer without coercing IDs", () => {
    expect(() => meetingInput({ title: "회의", meeting_date: "2026-02-30" })).toThrow();
    expect(() => meetingInput({ title: " ", meeting_date: "2026-11-01" })).toThrow();
    expect(() => meetingInput({ title: "회의", meeting_date: "2026-11-01", client_id: "x" })).toThrow();
    expect(meetingInput({ title: " 회의 ", meeting_date: "2026-11-01" })).toEqual({ title: "회의", meeting_date: "2026-11-01", client_id: null, participants: "", body: "" });
  });
  it("preserves content and meeting context in a portable Markdown file", () => {
    const text = meetingMarkdown({ title: "기획", meeting_date: "2026-11-01", participants: "유리", body: "## 결정\n- [ ] 확인" }, "고객A");
    expect(text).toContain("- 고객사: 고객A"); expect(text).toContain("- 참석자: 유리"); expect(text).toContain("## 결정\n- [ ] 확인");
  });
  it("bounds retrieval and supports reading long notes to the end", () => {
    const body = "a".repeat(12000) + "마지막 결정";
    const first = noteExcerpt(body, -1); expect(first.body.length).toBe(12000); expect(first.next_offset).toBe(12000);
    expect(noteExcerpt(body, first.next_offset!).body).toBe("마지막 결정"); expect(noteExcerpt(body, 12000).next_offset).toBeNull();
  });
});
