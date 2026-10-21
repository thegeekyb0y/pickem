import { describe, expect, it } from "vitest";
import { resolveTrustedOrigins } from "@/lib/auth-origins";

describe("resolveTrustedOrigins", () => {
  it("falls back to the deployment origin", () => {
    expect(
      resolveTrustedOrigins({ BETTER_AUTH_URL: "https://pickem.vercel.app" }),
    ).toEqual(["https://pickem.vercel.app"]);
  });

  it("prefers an explicit list and trims each entry", () => {
    expect(
      resolveTrustedOrigins({
        BETTER_AUTH_URL: "https://pickem-abc.vercel.app",
        BETTER_AUTH_TRUSTED_ORIGINS: "https://pickem.vercel.app, https://www.pickem.app",
      }),
    ).toEqual(["https://pickem.vercel.app", "https://www.pickem.app"]);
  });

  it("returns nothing when no origin is configured", () => {
    expect(resolveTrustedOrigins({})).toEqual([]);
  });
});
