import { describe, expect, it } from "vitest";
import { safeAuthRedirect } from "../auth-redirect";

describe("mobile login destinations", () => {
  it("returns to the assistant and preserves safe app queries", () => {
    expect(safeAuthRedirect("/assistant")).toBe("/assistant");
    expect(safeAuthRedirect("/schedule?month=2026-11")).toBe("/schedule?month=2026-11");
  });
  it("rejects external, protocol-relative and backslash destinations", () => {
    for (const path of ["https://other.test", "//other.test", "/\\other.test", "javascript:alert(1)", "/\n/other.test"]) expect(safeAuthRedirect(path)).toBe("/");
  });
  it("handles missing values and avoids returning to login", () => {
    for (const path of [null, "", {}, "/login?redirect=/assistant"]) expect(safeAuthRedirect(path)).toBe("/");
  });
});
