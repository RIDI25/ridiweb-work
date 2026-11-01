import { describe, expect, it } from "vitest";
import { clientPartnerLinks, collaborationPatch, matchesServiceChannel, type ServiceRelation } from "./service-partners";

const rows: ServiceRelation[] = [
  { id: "website", client_id: "a", service_type: "site_build", status: "active", deal_channel: "partner", partner_id: "p" },
  { id: "seo", client_id: "a", service_type: "seo", status: "active", deal_channel: "direct", partner_id: null },
  { id: "old", client_id: "a", service_type: "site_build", status: "done", deal_channel: "partner", partner_id: "p" },
  { id: "legacy", client_id: "b", service_type: "seo", status: "active" },
];

describe("contract-specific partnerships", () => {
  it("a mixed customer appears in both routes without duplicating the customer", () => {
    expect(matchesServiceChannel(rows, "a", "direct")).toBe(true);
    expect(matchesServiceChannel(rows, "a", "partner", "p")).toBe(true);
    expect(matchesServiceChannel(rows, "a", "partner", "other")).toBe(false);
    expect(clientPartnerLinks(rows, "a", [{ id: "p", name: "협력사" }])).toEqual([{ id: "p", name: "협력사" }]);
  });
  it("unclassified and contract-free customers remain in all, never inferred as direct", () => {
    expect(matchesServiceChannel(rows, "b", "all")).toBe(true);
    expect(matchesServiceChannel(rows, "b", "direct")).toBe(false);
    expect(matchesServiceChannel(rows, "c", "all")).toBe(true);
  });
  it("completed collaborations stay discoverable", () => {
    expect(matchesServiceChannel(rows.filter((r) => r.status === "done"), "a", "partner")).toBe(true);
  });
  it("requires a partner and clears a hidden partner when switching to direct", () => {
    expect(() => collaborationPatch({ deal_channel: "partner" })).toThrow("협력사를 선택");
    expect(collaborationPatch({ deal_channel: "direct", partner_id: "p" }).partner_id).toBeNull();
    expect(collaborationPatch({ partner_id: "p" }).partner_id).toBeNull();
  });
  it("keeps the three operational roles separate and bounds input", () => {
    expect(collaborationPatch({ deal_channel: "partner", partner_id: "p", communication_contact: " 담당 ", final_reviewer: "검수자", settlement_party: "정산처" })).toEqual({ deal_channel: "partner", partner_id: "p", communication_contact: "담당", final_reviewer: "검수자", settlement_party: "정산처" });
    expect(() => collaborationPatch({ settlement_party: "x".repeat(301) })).toThrow("300자");
  });
});
