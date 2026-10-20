import { describe, expect, it } from "vitest";
import {
  assertNotProductionDatabase,
  hostnameOf,
  resolveProductionDatabaseHost,
  resolveTargetDatabaseHost,
  type GuardEnv,
} from "../../../scripts/load/db-guard.mjs";

describe("hostnameOf", () => {
  it("keeps only the hostname and drops credentials, ports and paths", () => {
    expect(hostnameOf("postgresql://user:secret@db.example.com:5432/pickem?sslmode=require")).toBe(
      "db.example.com",
    );
    expect(hostnameOf("https://db.example.com/pickem")).toBe("db.example.com");
  });

  it("normalizes case and accepts a bare hostname", () => {
    expect(hostnameOf("DB.Example.COM")).toBe("db.example.com");
    expect(hostnameOf("  db.example.com  ")).toBe("db.example.com");
  });

  it("returns null for empty or unusable values", () => {
    expect(hostnameOf(undefined)).toBeNull();
    expect(hostnameOf("")).toBeNull();
  });
});

describe("database host resolution", () => {
  it("prefers an explicit production host over other sources", () => {
    const env = {
      PRODUCTION_DATABASE_HOST: "prod.example.com",
      PRODUCTION_DATABASE_URL: "postgresql://u:p@other.example.com/db",
      DATABASE_URL: "postgresql://u:p@runtime.example.com/db",
    } as GuardEnv;

    expect(resolveProductionDatabaseHost(env)).toBe("prod.example.com");
  });

  it("falls back to the runtime database url", () => {
    const env = { DATABASE_URL: "postgresql://u:p@runtime.example.com/db" } as GuardEnv;
    expect(resolveProductionDatabaseHost(env)).toBe("runtime.example.com");
  });

  it("resolves the target host from the test database url", () => {
    const env = {
      DATABASE_URL_TEST: "postgresql://u:p@branch.example.com/db",
      DATABASE_URL: "postgresql://u:p@prod.example.com/db",
    } as GuardEnv;

    expect(resolveTargetDatabaseHost(env)).toBe("branch.example.com");
  });
});

describe("assertNotProductionDatabase", () => {
  it("refuses when the target host matches the production host", () => {
    expect(() =>
      assertNotProductionDatabase({
        label: "the integration suite",
        targetHost: "db.example.com",
        productionHost: "db.example.com",
      }),
    ).toThrow(/matches the production database host/);
  });

  it("refuses when the target host cannot be determined", () => {
    expect(() =>
      assertNotProductionDatabase({
        targetHost: null,
        productionHost: "db.example.com",
      }),
    ).toThrow(/no target database host/);
  });

  it("refuses when the production host is unknown", () => {
    expect(() =>
      assertNotProductionDatabase({
        targetHost: "branch.example.com",
        productionHost: null,
      }),
    ).toThrow(/production database host is unknown/);
  });

  it("allows a distinct branch host", () => {
    expect(
      assertNotProductionDatabase({
        targetHost: "branch.example.com",
        productionHost: "db.example.com",
      }),
    ).toBe(true);
  });

  it("never includes a connection string in the failure message", () => {
    try {
      assertNotProductionDatabase({
        targetHost: "db.example.com",
        productionHost: "db.example.com",
      });
      throw new Error("expected the guard to refuse");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("postgresql://");
      expect(message).not.toContain("db.example.com");
    }
  });
});
