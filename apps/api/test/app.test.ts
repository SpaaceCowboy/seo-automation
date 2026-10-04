import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@roco/shared";

import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
const logger = createLogger({
  service: "api-test",
  environment: "test",
  level: "silent",
});

describe("crawl API", () => {
  it("queues bounded crawl commands and exposes status, summary, and cancellation", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const siteId = "22222222-2222-4222-8222-222222222222";
    const start = vi.fn(async () => ({ id: runId, status: "QUEUED" }));
    const get = vi.fn(async () => ({
      id: runId,
      siteId,
      status: "SUCCEEDED",
      startUrl: "https://example.com/",
      summary: { urlsCrawled: 10 },
      errorCode: null,
      errorMessage: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      startedAt: new Date("2026-01-01T00:00:01Z"),
      finishedAt: new Date("2026-01-01T00:00:11Z"),
    }));
    const cancel = vi.fn(async () => true);
    const app = buildApp({
      logger,
      readiness: async () => ({ database: true, queue: true }),
      crawls: { start, get, cancel },
    });
    apps.push(app);

    const queued = await app.inject({
      method: "POST",
      url: `/sites/${siteId}/crawls`,
      payload: { maxPages: 10, concurrency: 1 },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toEqual({ id: runId, status: "QUEUED" });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ siteId, maxPages: 10, concurrency: 1 }),
    );

    const status = await app.inject({ method: "GET", url: `/crawls/${runId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ id: runId, status: "SUCCEEDED" });

    const summary = await app.inject({
      method: "GET",
      url: `/crawls/${runId}/summary`,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ summary: { urlsCrawled: 10 } });

    const cancelled = await app.inject({
      method: "POST",
      url: `/crawls/${runId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(202);
    expect(cancel).toHaveBeenCalledWith(runId);
  });

  it("rejects invalid crawl identifiers and payloads", async () => {
    const app = buildApp({
      logger,
      readiness: async () => ({ database: true, queue: true }),
      crawls: {
        start: vi.fn(),
        get: vi.fn(),
        cancel: vi.fn(),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/sites/not-a-uuid/crawls",
      payload: { maxPages: 0 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_CRAWL_REQUEST" });
  });
});

describe("integration API", () => {
  it("validates and queues a bounded GSC backfill", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";
    const siteId = "22222222-2222-4222-8222-222222222222";
    const trigger = vi.fn(async () => ({ id: runId, status: "QUEUED" }));
    const app = buildApp({
      logger,
      readiness: async () => ({ database: true, queue: true }),
      integrations: {
        trigger,
        get: vi.fn(async () => null),
        freshness: vi.fn(async () => []),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: `/sites/${siteId}/integrations/gsc/sync`,
      payload: {
        mode: "backfill",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        dimensionSet: "PAGE_QUERY",
      },
    });
    expect(response.statusCode).toBe(202);
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId,
        provider: "GSC",
        mode: "backfill",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      }),
    );
  });

  it("rejects malformed dates before dispatch", async () => {
    const app = buildApp({
      logger,
      readiness: async () => ({ database: true, queue: true }),
      integrations: {
        trigger: vi.fn(),
        get: vi.fn(),
        freshness: vi.fn(),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/sites/22222222-2222-4222-8222-222222222222/integrations/ga4/sync",
      payload: { startDate: "2026-99-99" },
    });
    expect(response.statusCode).toBe(400);
  });
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
