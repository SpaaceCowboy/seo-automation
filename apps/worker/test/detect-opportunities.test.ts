import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";
import type { OpportunityRepository } from "@roco/db";
import { createLogger } from "@roco/shared";
import { createDetectionHandler } from "../src/jobs/detect-opportunities.js";
import {
  config,
  fixture,
} from "../../../packages/opportunities/test/fixtures.js";
const data = {
  runId: "11111111-1111-4111-8111-111111111111",
  siteId: "22222222-2222-4222-8222-222222222222",
  correlationId: "correlation",
};
function setup(status = "QUEUED") {
  const run = {
    id: data.runId,
    siteId: data.siteId,
    correlationId: data.correlationId,
    status,
  };
  const repository = {
    getRun: vi.fn(async () => run),
    captureInput: vi.fn(async () => ({ run, config, input: fixture() })),
    persistResult: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  } as unknown as OpportunityRepository;
  return {
    repository,
    handler: createDetectionHandler({
      repository,
      logger: createLogger({
        service: "test",
        environment: "test",
        level: "silent",
      }),
    }),
    job: { id: "job", data } as Job<unknown>,
  };
}
describe("opportunity worker", () => {
  it("loads frozen inputs, runs all detectors, persists results and skips successful redelivery", async () => {
    const s = setup();
    await s.handler([s.job]);
    expect(s.repository.persistResult).toHaveBeenCalledWith(
      data.runId,
      expect.objectContaining({ candidates: expect.any(Array) }),
      expect.any(Number),
    );
    const done = setup("SUCCEEDED");
    await done.handler([done.job]);
    expect(done.repository.captureInput).not.toHaveBeenCalled();
  });
  it("records safe failures and throws for queue retry", async () => {
    const s = setup();
    vi.mocked(s.repository.captureInput).mockRejectedValueOnce(
      new Error("sensitive payload"),
    );
    await expect(s.handler([s.job])).rejects.toThrow(
      "Opportunity detection failed",
    );
    expect(s.repository.fail).toHaveBeenCalledWith(data.runId);
  });
  it("rejects forged site context and malformed jobs before accessing evidence", async () => {
    const s = setup();
    await expect(
      s.handler([{ ...s.job, data: { ...data, siteId: data.runId } }]),
    ).rejects.toThrow("does not match");
    expect(s.repository.captureInput).not.toHaveBeenCalled();
    await expect(
      s.handler([{ ...s.job, data: { runId: "invalid" } }]),
    ).rejects.toThrow();
  });
});
