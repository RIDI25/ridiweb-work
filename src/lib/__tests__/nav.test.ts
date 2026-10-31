import { describe, expect, it } from "vitest";
import { getNavSection } from "../nav";

describe("navigation ownership", () => {
  it("keeps client performance pages in SEO/GEO and customer work in clients", () => {
    for (const tab of ["seo", "geo", "reports"]) expect(getNavSection(`/clients/customer-123/${tab}`)).toBe("/seo-geo");
    for (const tab of ["overview", "content", "info"]) expect(getNavSection(`/clients/customer-123/${tab}`)).toBe("/clients");
    expect(getNavSection("/clients/customer-123")).toBe("/clients");
  });
  it("maps old direct links to their new menu groups", () => {
    expect(getNavSection("/")).toBe("/schedule");
    expect(getNavSection("/tasks")).toBe("/schedule");
    expect(getNavSection("/sales")).toBe("/clients");
    expect(getNavSection("/quotes")).toBe("/clients");
    expect(getNavSection("/diagnosis")).toBe("/seo-geo");
    expect(getNavSection("/ledger")).toBe("/revenue");
  });
  it("does not treat similarly prefixed paths as a known menu", () => {
    expect(getNavSection("/clients-archive")).toBeNull();
    expect(getNavSection("/revenue-preview")).toBeNull();
    expect(getNavSection("/assistant")).toBe("/assistant");
  });
});
