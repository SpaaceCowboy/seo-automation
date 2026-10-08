import { createHash, timingSafeEqual } from "node:crypto";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@roco/shared";
import {
  sectionSchema,
  controlFilterSchema,
  type ControlSection,
} from "@roco/shared/control";
import type { Principal } from "@roco/workflow";
import { WorkflowError, requireRole } from "@roco/workflow";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseWorkflowAccess } from "./workflow-routes.js";
export interface ControlApiService {
  identity(this: void, p: Principal): Promise<unknown>;
  auditSession(
    this: void,
    p: Principal,
    event: "SIGN_IN" | "SIGN_OUT",
  ): Promise<void>;
  sites(this: void, p: Principal): Promise<unknown>;
  read(
    this: void,
    siteId: string,
    section: ControlSection,
    filter: unknown,
    p: Principal,
  ): Promise<unknown>;
  detail(
    this: void,
    siteId: string,
    section: ControlSection,
    id: string,
    p: Principal,
  ): Promise<unknown>;
}
export function registerControlRoutes(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  service: ControlApiService,
  access: string | undefined,
) {
  const credentials = parseWorkflowAccess(access);
  const params = z.object({
    siteId: z.string().uuid(),
    section: sectionSchema,
    id: z.string().uuid().optional(),
  });
  async function principal(header: string | undefined, correlationId: string) {
    if (!credentials.length) throw new WorkflowError("CONTROL_NOT_CONFIGURED");
    const hash = createHash("sha256")
      .update(header?.startsWith("Bearer ") ? header.slice(7) : "")
      .digest();
    let found: (typeof credentials)[number] | undefined;
    for (const credential of credentials)
      if (timingSafeEqual(credential.hash, hash)) found = credential;
    if (!found) throw new WorkflowError("UNAUTHORIZED");
    const p = { actorId: found.actorId, roles: found.roles, correlationId };
    await service.identity(p);
    return p;
  }
  // No earlier unauthenticated domain route is exposed when the control center is enabled.
  app.addHook("preHandler", async (request, reply) => {
    const path = request.routeOptions.url ?? "";
    if (
      path === "/health" ||
      path === "/ready" ||
      path.includes("/control") ||
      path.includes("/workflow") ||
      /opportunit|agent-runs|\/analysis/.test(path)
    )
      return;
    try {
      const p = await principal(request.headers.authorization, request.id);
      requireRole(p, request.method === "GET" ? "READ" : "OPERATOR");
    } catch {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  });
  for (const [method, url] of [
    ["GET", "/control/session"],
    ["POST", "/control/session"],
    ["DELETE", "/control/session"],
    ["GET", "/control/sites"],
    ["GET", "/sites/:siteId/control/:section"],
    ["GET", "/sites/:siteId/control/:section/:id"],
  ] as const)
    app.route({
      method,
      url,
      async handler(request, reply) {
        reply.header("cache-control", "no-store");
        try {
          const p = await principal(request.headers.authorization, request.id);
          if (url === "/control/session") {
            if (method === "POST") await service.auditSession(p, "SIGN_IN");
            if (method === "DELETE") await service.auditSession(p, "SIGN_OUT");
            return service.identity(p);
          }
          if (url === "/control/sites") return service.sites(p);
          const parsed = params.parse(request.params);
          const result = parsed.id
            ? await service.detail(parsed.siteId, parsed.section, parsed.id, p)
            : await service.read(
                parsed.siteId,
                parsed.section,
                controlFilterSchema.parse(request.query),
                p,
              );
          if (result === null)
            return reply.code(404).send({ error: "CONTROL_RECORD_NOT_FOUND" });
          return result;
        } catch (error) {
          if (error instanceof z.ZodError)
            return reply.code(400).send({ error: "INVALID_CONTROL_REQUEST" });
          if (error instanceof WorkflowError)
            return reply
              .code(
                error.code === "CONTROL_NOT_CONFIGURED"
                  ? 503
                  : error.code === "UNAUTHORIZED"
                    ? 401
                    : 403,
              )
              .send({ error: error.code });
          request.log.error(
            { errorCode: "CONTROL_READ_FAILED", requestId: request.id },
            "control operation failed",
          );
          return reply.code(500).send({ error: "CONTROL_READ_FAILED" });
        }
      },
    });
}
