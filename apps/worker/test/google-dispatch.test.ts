import { describe, expect, it, vi } from "vitest";
import type { IntegrationRepository } from "@roco/db";
import { createLogger } from "@roco/shared";
import { createGoogleDispatchHandler } from "../src/jobs/google-dispatch.js";
import type { Job } from "pg-boss";

const siteId = "22222222-2222-4222-8222-222222222222";
const logger = createLogger({
  service: "dispatch-test",
  environment: "test",
  level: "silent",
});
describe("scheduled Google imports", () => {
  function setup() {
    const keys: string[] = [];
    const repository = {
      getSiteScope: vi.fn(async () => ({
        canonicalOrigin: "https://example.com",
        allowedHosts: [],
      })),
      ensureAccount: vi.fn(async () => "account"),
      createSyncRun: vi.fn(async (input: { idempotencyKey: string }) => {
        keys.push(input.idempotencyKey);
        return { id: "run", status: "QUEUED" };
      }),
    } as unknown as IntegrationRepository;
    const boss = { send: vi.fn(async () => "job") };
    return { repository, boss, keys };
  }
  it("waits for finalized GSC dates and dispatches dimension sets independently", async () => {
    const { repository, boss } = setup();
    const handler = createGoogleDispatchHandler({
      repository,
      boss: boss as never,
      logger,
      properties: { gsc: "sc-domain:example.com" },
      clock: () => new Date("2026-10-07T04:00:00Z"),
    });
    await handler([{ data: { provider: "GSC", siteId } } as Job<unknown>]);
    expect(boss.send).toHaveBeenCalledTimes(3);
    expect(boss.send).toHaveBeenCalledWith(
      "google.gsc.sync",
      expect.objectContaining({
        startDate: "2026-10-04",
        endDate: "2026-10-04",
        dimensionSet: "PAGE",
      }),
    );
  });
  it("does not collapse distinct weekly PageSpeed runs into one monthly key", async () => {
    const { repository, boss, keys } = setup();
    for (const date of ["2026-10-05", "2026-10-12", "2026-10-13"])
      await createGoogleDispatchHandler({
        repository,
        boss: boss as never,
        logger,
        properties: {},
        clock: () => new Date(date + "T04:00:00Z"),
      })([{ data: { provider: "PAGESPEED", siteId } } as Job<unknown>]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
  });
});
