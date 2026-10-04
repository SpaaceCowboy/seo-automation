import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "@roco/shared";

import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
const logger = createLogger({
  service: "api-test",
  environment: "test",
  level: "silent",
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("API health", () => {
  it("reports liveness without checking dependencies", async () => {
    const app = buildApp({
      logger,
      readiness: () => Promise.reject(new Error("must not be called")),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "roco-seo-api",
    });
  });

  it("reports ready only when PostgreSQL and the queue schema are ready", async () => {
    const app = buildApp({
      logger,
      readiness: () => Promise.resolve({ database: true, queue: true }),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      services: { database: true, queue: true },
    });
  });

  it("returns 503 when queue infrastructure is unavailable", async () => {
    const app = buildApp({
      logger,
      readiness: () => Promise.resolve({ database: true, queue: false }),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      services: { database: true, queue: false },
    });
  });
});
