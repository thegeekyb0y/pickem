import { describe, expect, it } from "vitest";
import { isLocalHost, parseTarget, resolveLoadTestTarget } from "../../../scripts/load/target.mjs";

const baseEnv = {
  LOAD_TEST_SECRET: "probe-secret",
  LOAD_TEST_CONFIRM: "I_CONFIRM_PREVIEW_LOAD",
  NEON_BRANCH_CONFIRM: "I_CONFIRM_NEON_BRANCH",
  POLL_ID: "00000000-0000-4000-8000-000000000001",
};

describe("parseTarget", () => {
  it("parses protocol and hostname without the URL global", () => {
    expect(parseTarget("http://localhost:3000")).toEqual({
      protocol: "http:",
      hostname: "localhost",
    });
    expect(parseTarget("https://pickem-git-feature-team.vercel.app")).toEqual({
      protocol: "https:",
      hostname: "pickem-git-feature-team.vercel.app",
    });
  });

  it("drops credentials, ports, paths and queries", () => {
    expect(parseTarget("https://user:secret@Example.COM:8443/path?q=1")?.hostname).toBe(
      "example.com",
    );
  });

  it("returns null for values that are not absolute URLs", () => {
    expect(parseTarget("not-a-url")).toBeNull();
    expect(parseTarget("")).toBeNull();
  });
});

describe("isLocalHost", () => {
  it("accepts only localhost and 127.0.0.1", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("127.0.0.2")).toBe(false);
    expect(isLocalHost("example.com")).toBe(false);
  });
});

describe("resolveLoadTestTarget", () => {
  it("allows a local target only with the explicit local flag", () => {
    const target = resolveLoadTestTarget({
      ...baseEnv,
      BASE_URL: "http://localhost:3000",
      LOAD_TEST_ALLOW_LOCALHOST: "1",
    });
    expect(target.local).toBe(true);
    expect(target.hostname).toBe("localhost");
    expect(target.baseUrl).toBe("http://localhost:3000");
  });

  it("refuses a local target without the flag", () => {
    expect(() =>
      resolveLoadTestTarget({ ...baseEnv, BASE_URL: "http://localhost:3000" }),
    ).toThrow(/HTTPS URL of a Vercel preview deployment/);
  });

  it("refuses any non-local host when the local flag is set", () => {
    expect(() =>
      resolveLoadTestTarget({
        ...baseEnv,
        BASE_URL: "http://127.0.0.2:3000",
        LOAD_TEST_ALLOW_LOCALHOST: "1",
      }),
    ).toThrow(/only allows localhost and 127.0.0.1/);
    expect(() =>
      resolveLoadTestTarget({
        ...baseEnv,
        BASE_URL: "https://pickem.vercel.app",
        LOAD_TEST_ALLOW_LOCALHOST: "1",
      }),
    ).toThrow(/only allows localhost and 127.0.0.1/);
  });

  it("refuses a local target that is not plain http", () => {
    expect(() =>
      resolveLoadTestTarget({
        ...baseEnv,
        BASE_URL: "https://localhost:3000",
        LOAD_TEST_ALLOW_LOCALHOST: "1",
      }),
    ).toThrow(/must use http/);
  });

  it("allows a Vercel preview host without the local flag", () => {
    const target = resolveLoadTestTarget({
      ...baseEnv,
      BASE_URL: "https://pickem-git-feature-team.vercel.app",
    });
    expect(target.local).toBe(false);
    expect(target.hostname).toBe("pickem-git-feature-team.vercel.app");
  });

  it("refuses a non-preview host without the local flag", () => {
    expect(() =>
      resolveLoadTestTarget({ ...baseEnv, BASE_URL: "https://pickem.vercel.app" }),
    ).toThrow(/does not look like a Vercel preview host/);
  });

  it("still requires the confirmation flags, the secret and the poll id", () => {
    const preview = "https://pickem-git-feature-team.vercel.app";
    expect(() => resolveLoadTestTarget({ ...baseEnv, BASE_URL: preview, LOAD_TEST_CONFIRM: "" })).toThrow(
      /LOAD_TEST_CONFIRM/,
    );
    expect(() => resolveLoadTestTarget({ ...baseEnv, BASE_URL: preview, LOAD_TEST_SECRET: "" })).toThrow(
      /LOAD_TEST_SECRET/,
    );
    expect(() =>
      resolveLoadTestTarget({ ...baseEnv, BASE_URL: preview, NEON_BRANCH_CONFIRM: "" }),
    ).toThrow(/NEON_BRANCH_CONFIRM/);
    expect(() => resolveLoadTestTarget({ ...baseEnv, BASE_URL: preview, POLL_ID: "" })).toThrow(
      /POLL_ID/,
    );
  });

  it("refuses a missing or malformed base url", () => {
    expect(() => resolveLoadTestTarget({ ...baseEnv })).toThrow(/BASE_URL must be set/);
    expect(() => resolveLoadTestTarget({ ...baseEnv, BASE_URL: "not-a-url" })).toThrow(
      /absolute URL/,
    );
  });
});
