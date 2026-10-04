import type { Job } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import type { FoundationJobRepository } from "@roco/db";
import { createLogger } from "@roco/shared";

import { createFoundationNoopHandler } from "../src/jobs/foundation-noop.js";

function createJob(id: string, idempotencyKey: string): Job<unknown> {
  return {
    id,
    name: "foundation.noop",
    data: { idempotencyKey, correlationId: "test-correlation" },
    expireInSeconds: 60,
    heartbeatSeconds: null,
    retryCount: 0,
    signal: AbortSignal.abort(),
  };
}

describe("foundation no-op job", () => {
  it("performs the application-level effect once for duplicate commands", async () => {
    const claimedKeys = new Set<string>();
    const succeed = vi.fn(() => Promise.resolve(undefined));
    const repository: FoundationJobRepository = {
      claim(input) {
        if (claimedKeys.has(input.idempotencyKey))
          return Promise.resolve(false);
        claimedKeys.add(input.idempotencyKey);
        return Promise.resolve(true);
      },
      succeed,
      fail: vi.fn(() => Promise.resolve(undefined)),
    };
    const handler = createFoundationNoopHandler({
      logger: createLogger({
        service: "worker-test",
        environment: "test",
        level: "silent",
      }),
      repository,
    });

    await handler([
      createJob("job-1", "same-command"),
      createJob("job-2", "same-command"),
    ]);

    expect(succeed).toHaveBeenCalledTimes(1);
    expect(succeed).toHaveBeenCalledWith("same-command");
  });
});
