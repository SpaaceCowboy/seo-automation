import { expect, it, vi } from "vitest";
import { createAgentRepository } from "../src/agent-repository.js";
it("releases the borrowed connection even when advisory unlock fails", async () => {
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockRejectedValueOnce(new Error("unlock unavailable")),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  const repository = createAgentRepository(
    {} as Parameters<typeof createAgentRepository>[0],
    pool as unknown as Parameters<typeof createAgentRepository>[1],
  );
  await expect(
    repository.withRunLock("fixture-run", async () => {}),
  ).rejects.toThrow("unlock unavailable");
  expect(client.release).toHaveBeenCalledOnce();
});
