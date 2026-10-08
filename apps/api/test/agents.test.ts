import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@roco/shared";
import { buildApp, type AgentApiService } from "../src/app.js";
const siteId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  token = "phase-five-private-token-at-least-32-chars";
function setup(enabled = true, key: string | undefined = token) {
  const service: AgentApiService = {
    retry: vi.fn(async () => ({ id, status: "FAILED" })),
    trigger: vi.fn(async () => ({ id, status: "QUEUED" })),
    inspect: vi.fn(async () => null),
    draft: vi.fn(async () => null),
  };
  const app = buildApp({
    logger: createLogger({
      service: "test",
      environment: "test",
      level: "silent",
    }),
    readiness: async () => ({ database: true, queue: true }),
    agents: service,
    agentToken: key,
    agentsEnabled: enabled,
  });
  return { app, service };
}
describe("Phase 5 API boundary", () => {
  it("authenticates analysis and result reads; keeps disabled analysis fail-closed", async () => {
    const { app, service } = setup();
    for (const [method, url] of [
      ["POST", `/sites/${siteId}/opportunities/${id}/analysis`],
      ["GET", `/sites/${siteId}/agent-runs/${id}`],
      ["POST", `/sites/${siteId}/agent-runs/${id}/retry`],
      ["GET", `/sites/${siteId}/agent-runs/${id}/draft`],
    ] as const)
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    expect(service.trigger).not.toHaveBeenCalled();
    await app.close();
    const disabled = setup(false);
    expect(
      (
        await disabled.app.inject({
          method: "POST",
          url: `/sites/${siteId}/opportunities/${id}/analysis`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(503);
    await disabled.app.close();
  });
  it("queues only validated commands and rejects injected model, actor or execution fields", async () => {
    const { app, service } = setup();
    const headers = {
      authorization: `Bearer ${token}`,
      "x-correlation-id": "agent-request",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/sites/${siteId}/opportunities/${id}/analysis`,
          headers,
          payload: { idempotencyKey: "analysis-key" },
        })
      ).statusCode,
    ).toBe(202);
    expect(service.trigger).toHaveBeenCalledWith({
      siteId,
      opportunityId: id,
      correlationId: "agent-request",
      idempotencyKey: "analysis-key",
    });
    for (const payload of [
      { execute: true },
      { model: "expensive" },
      { actorId: id },
      { approve: true },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/sites/${siteId}/opportunities/${id}/analysis`,
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    await app.close();
  });
  it("uses site-scoped reads and does not invent drafts for incomplete/failed runs", async () => {
    const { app, service } = setup();
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/sites/${siteId}/agent-runs/${id}/draft`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(service.draft).toHaveBeenCalledWith(siteId, id);
    await app.close();
  });
});

describe("safe retry endpoint", () => {
  it("queues a scoped retry and rejects caller-supplied overrides", async () => {
    const { app, service } = setup();
    const headers = {
      authorization: `Bearer ${token}`,
      "x-correlation-id": "retry-request",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/sites/${siteId}/agent-runs/${id}/retry`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(202);
    expect(service.retry).toHaveBeenCalledWith({
      siteId,
      runId: id,
      correlationId: "retry-request",
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/sites/${siteId}/agent-runs/${id}/retry`,
          headers,
          payload: { model: "replacement" },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
