import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";
import type { AgentRepository } from "@roco/db";
import { createFakeProvider } from "@roco/llm";
import { createLogger } from "@roco/shared";
import { createAnalysisHandler } from "../src/jobs/analyze-opportunity.js";
import {
  bundle,
  policy,
  memoryJournal,
  respond,
  ids,
} from "../../../packages/agents/test/fixtures.js";
function setup(status = "QUEUED") {
  const run = {
    id: ids.score,
    siteId: ids.site,
    correlationId: "agent-job",
    status,
    attemptCount: 0,
  };
  const store = memoryJournal();
  const repository = {
    getRun: vi.fn(async () => run),
    withRunLock: vi.fn(async (_id: string, work: () => Promise<void>) => {
      await work();
      return true;
    }),
    start: vi.fn(async () => ({ run, bundle: bundle(), policy: policy() })),
    journal: () => store.journal,
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  } as unknown as AgentRepository;
  const provider = createFakeProvider(respond);
  const dependencies = {
    repository,
    policy: policy(),
    providers: new Map([[provider.name, provider]]),
    logger: createLogger({
      service: "test",
      environment: "test",
      level: "silent",
    }),
  };
  const job = {
    id: "job",
    data: {
      runId: run.id,
      siteId: run.siteId,
      correlationId: run.correlationId,
    },
  } as Job<unknown>;
  return { repository, dependencies, job };
}
describe("agent job", () => {
  it("produces validated drafts and skips successful redelivery", async () => {
    const s = setup();
    await createAnalysisHandler(s.dependencies)([s.job]);
    expect(s.repository.complete).toHaveBeenCalledWith(
      ids.score,
      expect.objectContaining({ status: "DRAFT", executable: false }),
    );
    const done = setup("SUCCEEDED");
    await createAnalysisHandler(done.dependencies)([done.job]);
    expect(done.repository.start).not.toHaveBeenCalled();
  });
  it("records disabled/configuration failure without a provider call", async () => {
    const s = setup();
    await expect(
      createAnalysisHandler({ ...s.dependencies, policy: null })([s.job]),
    ).rejects.toThrow("DISABLED");
    expect(s.repository.fail).toHaveBeenCalledWith(
      ids.score,
      "AGENT_LAYER_DISABLED",
    );
    expect(s.repository.start).not.toHaveBeenCalled();
  });
  it("rejects forged site context and never completes a failed workflow", async () => {
    const s = setup();
    await expect(
      createAnalysisHandler(s.dependencies)([
        { ...s.job, data: { ...(s.job.data as object), siteId: ids.page } },
      ]),
    ).rejects.toThrow("context");
    expect(s.repository.complete).not.toHaveBeenCalled();
  });
});

describe("safe failure metadata", () => {
  it("does not forward provider/database payloads into queue error causes", async () => {
    const s = setup();
    vi.mocked(s.repository.start).mockRejectedValueOnce(
      new Error("credential and raw evidence"),
    );
    let thrown: unknown;
    try {
      await createAnalysisHandler(s.dependencies)([s.job]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain("credential");
    expect(String((thrown as Error).cause)).not.toContain("raw evidence");
    expect(s.repository.fail).toHaveBeenCalledWith(
      ids.score,
      "AGENT_WORKFLOW_FAILED",
    );
  });
});
