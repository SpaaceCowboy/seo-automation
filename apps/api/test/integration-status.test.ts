import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createLogger } from "@roco/shared";
import { statusFixture } from "../../../packages/shared/test/integration-fixture.js";
const token = "status-role-token-more-than-thirty-two-characters",
  actorId = "11111111-1111-4111-8111-111111111111",
  checkId = "22222222-2222-4222-8222-222222222222";
function setup(role = "VIEWER") {
  const read = vi.fn(async () => statusFixture()),
    check = vi.fn(async () => ({
      id: checkId,
      status: "QUEUED",
      enqueue: true,
    }));
  const app = buildApp({
    logger: createLogger({
      service: "api-status-test",
      environment: "test",
      level: "silent",
    }),
    readiness: async () => ({ database: true, queue: true }),
    workflowAccess: JSON.stringify([{ token, actorId, roles: [role] }]),
    control: {
      identity: async () => ({
        actorId,
        displayName: "Fixture",
        roles: [role],
      }),
      auditSession: async () => {},
      sites: async () => [],
      read: async () => ({}),
      detail: async () => null,
      integrations: read,
      checkOpenai: check,
    },
  });
  return { app, read, check };
}
describe("authenticated integration status", () => {
  it("allows viewers to read but not enqueue a connection check", async () => {
    const s = setup();
    expect((await s.app.inject("/control/integrations")).statusCode).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    const response = await s.app.inject({
      url: "/control/integrations",
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/control/integrations/openai/check",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(s.check).not.toHaveBeenCalled();
    await s.app.close();
  });
  it("accepts operator checks and rejects client-selected models/URLs/settings", async () => {
    const s = setup("OPERATOR"),
      headers = { authorization: `Bearer ${token}` };
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/control/integrations/openai/check",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/control/integrations/openai/check",
          headers,
          payload: { model: "other-model", key: "secret" },
        })
      ).statusCode,
    ).toBe(400);
    expect(s.check).toHaveBeenCalledTimes(1);
    expect(
      (
        await s.app.inject({
          url: "/control/integrations?siteId=invalid",
          headers,
        })
      ).statusCode,
    ).toBe(400);
    await s.app.close();
  });
  it("fails closed if a service attempts to return fields outside the safe contract", async () => {
    const s = setup();
    s.read.mockResolvedValueOnce({
      ...statusFixture(),
      key: "private-key",
    } as ReturnType<typeof statusFixture>);
    const response = await s.app.inject({
      url: "/control/integrations",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("private-key");
    await s.app.close();
  });
});
