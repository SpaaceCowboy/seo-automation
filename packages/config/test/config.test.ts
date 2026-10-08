import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  parseApiConfig,
  parseWorkerConfig,
} from "../src/index.js";

const validDatabaseUrl = "postgresql://user:password@127.0.0.1:5432/roco_seo";

describe("configuration", () => {
  it("parses API defaults and coerces the port", () => {
    const config = parseApiConfig({
      DATABASE_URL: validDatabaseUrl,
      API_PORT: "4100",
    });

    expect(config).toMatchObject({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      API_HOST: "127.0.0.1",
      API_PORT: 4100,
    });
  });

  it("fails fast with a safe, actionable database error", () => {
    expect(() => parseApiConfig({ DATABASE_URL: "not-a-url" })).toThrow(
      ConfigurationError,
    );

    try {
      parseApiConfig({ DATABASE_URL: "not-a-url" });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).not.toContain("password=");
    }
  });

  it("parses worker booleans and bounded shutdown timeout", () => {
    const config = parseWorkerConfig({
      DATABASE_URL: validDatabaseUrl,
      WORKER_HEALTH_JOB_ENABLED: "false",
      WORKER_SHUTDOWN_TIMEOUT_MS: "2500",
    });

    expect(config.WORKER_HEALTH_JOB_ENABLED).toBe(false);
    expect(config.WORKER_SHUTDOWN_TIMEOUT_MS).toBe(2500);
  });

  it("rejects a missing database URL", () => {
    expect(() => parseWorkerConfig({})).toThrow("DATABASE_URL is required");
  });
  it("requires private access in production and complete schedule configuration", () => {
    expect(() =>
      parseApiConfig({
        DATABASE_URL: validDatabaseUrl,
        NODE_ENV: "production",
      }),
    ).toThrow("named access is required");
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: validDatabaseUrl,
        GOOGLE_SCHEDULES_ENABLED: "true",
      }),
    ).toThrow("GOOGLE_SITE_ID");
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: validDatabaseUrl,
        GOOGLE_SITE_ID: "11111111-1111-4111-8111-111111111111",
        GOOGLE_SCHEDULES_ENABLED: "true",
        GSC_PROPERTY: "sc-domain:example.com",
      }),
    ).toThrow("GOOGLE_CREDENTIALS_FILE");
  });
});
