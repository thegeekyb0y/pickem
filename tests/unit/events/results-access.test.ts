import { describe, expect, it } from "vitest";
import { resolveResultsAccess } from "@/lib/events/results-access";

describe("results access", () => {
  it("allows public and unlisted published polls through their event URL", () => {
    expect(resolveResultsAccess({ status: "open", visibility: "discoverable", creatorUserId: "owner" })).toBe("public");
    expect(resolveResultsAccess({ status: "closed", visibility: "unlisted", creatorUserId: "owner" })).toBe("public");
  });

  it("requires an unlock for passcode results and keeps the response private", () => {
    const event = { status: "open", visibility: "passcode", creatorUserId: "owner" };
    expect(resolveResultsAccess(event)).toBe("locked");
    expect(resolveResultsAccess(event, { passcodeUnlocked: true })).toBe("private");
  });

  it("limits draft results to the creator", () => {
    const draft = { status: "draft", visibility: "unlisted", creatorUserId: "owner" };
    expect(resolveResultsAccess(draft)).toBe("not-found");
    expect(resolveResultsAccess(draft, { userId: "other" })).toBe("not-found");
    expect(resolveResultsAccess(draft, { userId: "owner" })).toBe("private");
  });
});
