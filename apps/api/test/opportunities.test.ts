import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@roco/shared";
import { buildApp, type OpportunityApiService } from "../src/app.js";
const siteId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const token = "phase4-private-token-at-least-32-chars";
function setup(credential: string | null = token) {
  const service: OpportunityApiService = {
    changeStatus: vi.fn(async () => {}),
    trigger: vi.fn(async () => ({ id, status: "QUEUED" })),
    list: vi.fn(async () => ({ items: [], hasMore: false })),
    detail: vi.fn(async () => null),
    run: vi.fn(async () => null),
  };
  const app = buildApp({
    logger: createLogger({
      service: "test",
      environment: "test",
      level: "silent",
    }),
    readiness: async () => ({ database: true, queue: true }),
    opportunities: service,
    opportunityToken: credential ?? undefined,
  });
  return { app, service };
}
describe("opportunity API", () => {
  it("validates operator status changes without accepting caller-supplied actor identity", async () => {
    const { app, service } = setup();
    const headers = { authorization: `Bearer ${token}` };
    const payload = {
      status: "DISMISSED",
      expectedStatus: "OPEN",
      reason: "False positive",
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/sites/${siteId}/opportunities/${id}/status`,
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(204);
    expect(service.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ...payload, siteId, id }),
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/sites/${siteId}/opportunities/${id}/status`,
          headers,
          payload: { ...payload, actorId: siteId },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
  it("authenticates all opportunity reads and mutations and fails closed without a token", async () => {
    const { app, service } = setup();
    for (const [method, url] of [
      ["POST", `/sites/${siteId}/opportunity-runs`],
      ["PATCH", `/sites/${siteId}/opportunities/${id}/status`],
      ["GET", `/sites/${siteId}/opportunities`],
      ["GET", `/sites/${siteId}/opportunities/${id}`],
      ["GET", `/sites/${siteId}/opportunity-runs/${id}`],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method,
            url,
            headers: { authorization: "Bearer wrong" },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(service.trigger).not.toHaveBeenCalled();
    await app.close();
    const disabled = setup(null);
    expect(
      (
        await disabled.app.inject({
          method: "GET",
          url: `/sites/${siteId}/opportunities`,
        })
      ).statusCode,
    ).toBe(503);
    await disabled.app.close();
  });
  it("queues validated commands, propagates correlation and rejects extra fields", async () => {
    const { app, service } = setup();
    const headers = {
      authorization: `Bearer ${token}`,
      "x-correlation-id": "phase4-test",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/sites/${siteId}/opportunity-runs`,
          headers,
          payload: { config: { windowDays: 7 } },
        })
      ).statusCode,
    ).toBe(202);
    expect(service.trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId,
        correlationId: "phase4-test",
        config: expect.objectContaining({ windowDays: 7 }),
      }),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/sites/${siteId}/opportunity-runs`,
          headers,
          payload: { execute: true },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
  it("validates filters, pagination and site-scoped detail", async () => {
    const { app, service } = setup();
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/sites/${siteId}/opportunities?type=CTR&status=OPEN&minScore=20&limit=2`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(service.list).toHaveBeenCalledWith(siteId, {
      type: "CTR",
      status: "OPEN",
      minScore: 20,
      limit: 2,
      offset: 0,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/sites/${siteId}/opportunities?limit=101`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/sites/${siteId}/opportunities/${id}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(service.detail).toHaveBeenCalledWith(siteId, id);
    await app.close();
  });
});
