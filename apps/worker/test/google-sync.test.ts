import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";

import type { IntegrationRepository } from "@roco/db";
import { createLogger } from "@roco/shared";

import { createGscSyncHandler } from "../src/jobs/google-sync.js";

const logger = createLogger({
  service: "google-worker-test",
  environment: "test",
  level: "silent",
});
const syncRunId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";

function run(status = "QUEUED") {
  return {
    id: syncRunId,
    siteId,
    provider: "GSC" as const,
    jobType: "sync-gsc",
    dimensionSet: "PAGE",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    status,
    idempotencyKey: "gsc-test",
    rowsRead: 0,
    rowsWritten: 0,
    requestCount: 0,
    unmatchedUrlCount: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  };
}

const job = {
  id: "job-1",
  data: {
    syncRunId,
    siteId,
    correlationId: "correlation",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    dimensionSet: "PAGE",
  },
} as Job<unknown>;

describe("Google worker retries and failures", () => {
  it("persists a successful normalized batch", async () => {
    const persistGscRows = vi.fn(async () => 1);
    const complete = vi.fn(async () => undefined);
    const repository = {
      getSyncRun: vi.fn(async () => run()),
      markRunning: vi.fn(async () => true),
      getSiteScope: vi.fn(async () => ({
        canonicalOrigin: "https://example.com",
        allowedHosts: [{ host: "example.com", includeSubdomains: false }],
      })),
      persistGscRows,
      recordUnmatchedUrls: vi.fn(async () => undefined),
      complete,
      fail: vi.fn(async () => undefined),
    } as unknown as IntegrationRepository;
    const client = {
      queryAll: vi.fn(async () => ({
        requestCount: 1,
        rows: [
          {
            dimensionSet: "PAGE" as const,
            date: "2026-09-01",
            page: "https://example.com/a",
            query: null,
            country: "irn",
            device: "MOBILE",
            searchType: "web",
            dataState: "final",
            clicks: 1,
            impressions: 2,
            ctr: 0.5,
            position: 3,
          },
        ],
      })),
    };
    await createGscSyncHandler({
      logger,
      repository,
      client,
      property: "sc-domain:example.com",
    })([job]);
    expect(persistGscRows).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      syncRunId,
      expect.objectContaining({ rowsRead: 1, rowsWritten: 1, requestCount: 1 }),
    );
  });

  it("records a safe failure and rethrows so pg-boss can retry", async () => {
    const failure = vi.fn(async () => undefined);
    const markRunning = vi.fn(async () => true);
    const repository = {
      getSyncRun: vi.fn(async () => run("FAILED")),
      markRunning,
      getSiteScope: vi.fn(async () => ({
        canonicalOrigin: "https://example.com",
        allowedHosts: [{ host: "example.com", includeSubdomains: false }],
      })),
      recordUnmatchedUrls: vi.fn(async () => undefined),
      fail: failure,
    } as unknown as IntegrationRepository;
    const client = {
      queryAll: vi.fn(async () => {
        throw new Error("secret provider detail");
      }),
    };
    await expect(
      createGscSyncHandler({
        logger,
        repository,
        client,
        property: "sc-domain:example.com",
      })([job]),
    ).rejects.toThrow("SYNC_FAILED");
    expect(markRunning).toHaveBeenCalledWith(syncRunId);
    expect(failure).toHaveBeenCalledWith(
      syncRunId,
      "SYNC_FAILED",
      "The Google synchronization failed. Review structured worker logs.",
    );
  });
});
