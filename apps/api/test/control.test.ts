import { describe, it, expect, vi } from "vitest";
import { createLogger } from "@roco/shared";
import { WorkflowError } from "@roco/workflow";
import { controlFilterSchema } from "@roco/shared/control";
import { buildApp } from "../src/app.js";
import type { ControlApiService } from "../src/control-routes.js";
const actorId = "11111111-1111-4111-8111-111111111111",
  siteId = "22222222-2222-4222-8222-222222222222",
  token = "named-control-credential-at-least-32-chars";
function setup(
  access: string | undefined = JSON.stringify([
    { token, actorId, roles: ["VIEWER"] },
  ]),
) {
  const read = vi.fn(async () => ({ items: [], hasMore: false })),
    identity = vi.fn(async () => ({
      actorId,
      displayName: "Viewer",
      roles: ["VIEWER"],
    }));
  const service: ControlApiService = {
    identity,
    auditSession: vi.fn(async () => undefined),
    sites: vi.fn(async () => []),
    read,
    detail: vi.fn(async () => null),
  };
  return {
    service,
    read,
    identity,
    app: buildApp({
      logger: createLogger({
        service: "test",
        environment: "test",
        level: "silent",
      }),
      readiness: async () => ({ database: true, queue: true }),
      control: service,
      workflowAccess: access,
    }),
  };
}
describe("private control read API", () => {
  it("fails closed, protects earlier routes and binds the named identity", async () => {
    const { app, read } = setup();
    expect(
      (await app.inject(`/sites/${siteId}/control/overview`)).statusCode,
    ).toBe(401);
    expect(
      (await app.inject(`/sites/${siteId}/integrations/freshness`)).statusCode,
    ).toBe(401);
    const result = await app.inject({
      url: `/sites/${siteId}/control/issues?severity=CRITICAL&limit=10`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(read).toHaveBeenCalledWith(
      siteId,
      "issues",
      expect.objectContaining({ severity: "CRITICAL", limit: 10 }),
      expect.objectContaining({ actorId, roles: ["VIEWER"] }),
    );
    await app.close();
    const disabled = setup("");
    expect((await disabled.app.inject("/control/sites")).statusCode).toBe(503);
    await disabled.app.close();
  });
  it("rejects invalid pagination/date bounds and disabled actors", async () => {
    const { app, identity } = setup();
    const headers = { authorization: `Bearer ${token}` };
    for (const suffix of [
      "?limit=500",
      "?offset=-1",
      "?startDate=2026-01-01&endDate=2026-10-01",
      "?startDate=2026-10-01&endDate=2026-09-01",
      "?reviewer=forged",
    ])
      expect(
        (
          await app.inject({
            url: `/sites/${siteId}/control/performance${suffix}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
    identity.mockRejectedValueOnce(new WorkflowError("HUMAN_ACTOR_REQUIRED"));
    expect(
      (await app.inject({ url: "/control/sites", headers })).statusCode,
    ).toBe(403);
    await app.close();
  });
  it("returns safe errors, audits sign-in and handles absent details", async () => {
    const { app, service, read } = setup();
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/control/session", headers });
    expect(service.auditSession).toHaveBeenCalledOnce();
    expect(
      (
        await app.inject({
          url: `/sites/${siteId}/control/opportunities/${actorId}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    read.mockRejectedValueOnce(new Error("private credential / SQL details"));
    const response = await app.inject({
      url: `/sites/${siteId}/control/overview`,
      headers,
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("credential");
    await app.close();
  });
  it("keeps dataset and calendar validation explicit", () => {
    expect(() =>
      controlFilterSchema.parse({
        dataset: "QUERY",
        pageUrl: "https://example.test/page",
      }),
    ).toThrow();
    expect(controlFilterSchema.parse({ dataset: "PAGE_QUERY" }).dataset).toBe(
      "PAGE_QUERY",
    );
    expect(() =>
      controlFilterSchema.parse({
        startDate: "2026-02-30",
        endDate: "2026-03-01",
      }),
    ).toThrow();
  });
});

describe("control request log minimization", () => {
  it("logs route/status/latency without private query strings or malformed bodies", async () => {
    const logger = createLogger({
      service: "safe-log-test",
      environment: "test",
      level: "silent",
    });
    const info = vi.spyOn(logger, "info"),
      error = vi.spyOn(logger, "error");
    const app = buildApp({
      logger,
      readiness: () => Promise.resolve({ database: true, queue: true }),
    });
    app.addHook("onRequest", (request, _reply, done) => {
      request.log = logger;
      done();
    });
    await app.inject("/health?credential=private-query-marker");
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/health",
        statusCode: 200,
        latencyMs: expect.any(Number),
      }),
      "request completed",
    );
    const bad = await app.inject({
      method: "POST",
      url: "/unknown",
      headers: { "content-type": "application/json" },
      payload: '{"private-body-marker"',
    });
    expect(bad.statusCode).toBe(400);
    expect(
      JSON.stringify([...info.mock.calls, ...error.mock.calls]),
    ).not.toContain("private-query-marker");
    expect(
      JSON.stringify([...info.mock.calls, ...error.mock.calls]),
    ).not.toContain("private-body-marker");
    await app.close();
  });
});
