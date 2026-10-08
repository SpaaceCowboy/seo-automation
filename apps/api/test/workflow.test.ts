import { describe, expect, it, vi } from "vitest";
import { WorkflowError } from "@roco/workflow";
import { createLogger } from "@roco/shared";
import { buildApp } from "../src/app.js";
import {
  parseWorkflowAccess,
  type WorkflowApiService,
} from "../src/workflow-routes.js";
const actorId = "11111111-1111-4111-8111-111111111111",
  siteId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  token = "workflow-private-credential-at-least-32-chars";
function setup(
  access = JSON.stringify([{ token, actorId, roles: ["APPROVER"] }]),
) {
  const service: WorkflowApiService = {
    invoke: vi.fn(async () => ({ ok: true })),
  };
  const app = buildApp({
    logger: createLogger({
      service: "test",
      environment: "test",
      level: "silent",
    }),
    readiness: async () => ({ database: true, queue: true }),
    workflow: service,
    workflowAccess: access,
  });
  return { app, service };
}
describe("workflow API identity", () => {
  it("fails closed without registry and authenticates every operation", async () => {
    const { app } = setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/sites/${siteId}/workflow/recommendations/${id}/decisions`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/sites/${siteId}/workflow/changes/${id}/measurements`,
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
    const disabled = setup("");
    expect(
      (
        await disabled.app.inject({
          method: "GET",
          url: `/sites/${siteId}/workflow/recommendations`,
        })
      ).statusCode,
    ).toBe(503);
    await disabled.app.close();
  });
  it("binds principal to authenticated registry rather than request reviewers", async () => {
    const { app, service } = setup();
    const body = {
      expectedVersionId: id,
      expectedState: "READY_FOR_REVIEW",
      action: "APPROVE",
      reason: "Reviewed evidence",
    };
    const response = await app.inject({
      method: "POST",
      url: `/sites/${siteId}/workflow/recommendations/${id}/decisions`,
      headers: {
        authorization: `Bearer ${token}`,
        "x-correlation-id": "review-request",
      },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    expect(service.invoke).toHaveBeenCalledWith(
      "TRANSITION",
      siteId,
      id,
      body,
      { actorId, roles: ["APPROVER"], correlationId: "review-request" },
    );
    await app.close();
  });
  it("reports authorization failures without raw errors or credential disclosure", async () => {
    const { app, service } = setup();
    vi.mocked(service.invoke).mockRejectedValueOnce(
      new WorkflowError("WORKFLOW_FORBIDDEN"),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/sites/${siteId}/workflow/recommendations`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(() =>
      parseWorkflowAccess(
        JSON.stringify([{ token, actorId, roles: ["FAKE"] }]),
      ),
    ).toThrow("invalid");
    expect(() =>
      parseWorkflowAccess(
        JSON.stringify([
          { token, actorId, roles: ["OPERATOR"] },
          { token, actorId, roles: ["APPROVER"] },
        ]),
      ),
    ).toThrow("invalid");
    await app.close();
  });
});
