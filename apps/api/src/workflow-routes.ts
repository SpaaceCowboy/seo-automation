import { createHash } from "node:crypto";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@roco/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolvePrincipal } from "./staff-principal.js";
import { accessSchema, WorkflowError, type Principal } from "@roco/workflow";
export type WorkflowOperation =
  | "CREATE"
  | "LIST"
  | "DETAIL"
  | "REVISE"
  | "TRANSITION"
  | "IMPLEMENT"
  | "LEDGER"
  | "REVERT"
  | "CORRECTION"
  | "BASELINE"
  | "HISTORY"
  | "MEASURE30"
  | "MEASURE60"
  | "MEASURE90";
export interface WorkflowApiService {
  invoke(
    this: void,
    operation: WorkflowOperation,
    siteId: string,
    id: string | null,
    body: unknown,
    principal: Principal,
  ): Promise<unknown>;
}
export function parseWorkflowAccess(raw: string | undefined) {
  if (!raw) return [];
  try {
    return accessSchema.parse(JSON.parse(raw)).map((entry) => ({
      hash: createHash("sha256").update(entry.token).digest(),
      actorId: entry.actorId,
      roles: entry.roles,
    }));
  } catch {
    throw new Error(
      "WORKFLOW_ACCESS_JSON is invalid; check identities, roles and credential length.",
    );
  }
}
export function registerWorkflowRoutes(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  service: WorkflowApiService,
  rawAccess: string | undefined,
) {
  const credentials = parseWorkflowAccess(rawAccess);
  const paramsSchema = z.object({
    siteId: z.string().uuid(),
    id: z.string().uuid().optional(),
  });
  const definitions: ["GET" | "POST", string, WorkflowOperation][] = [
    ["POST", "/recommendations", "CREATE"],
    ["GET", "/recommendations", "LIST"],
    ["GET", "/recommendations/:id", "DETAIL"],
    ["POST", "/recommendations/:id/versions", "REVISE"],
    ["POST", "/recommendations/:id/decisions", "TRANSITION"],
    ["POST", "/recommendations/:id/implementation", "IMPLEMENT"],
    ["GET", "/changes/:id", "LEDGER"],
    ["POST", "/changes/:id/reverts", "REVERT"],
    ["POST", "/changes/:id/corrections", "CORRECTION"],
    ["POST", "/changes/:id/baselines", "BASELINE"],
    ["GET", "/changes/:id/measurements", "HISTORY"],
    ["POST", "/changes/:id/measurements/30", "MEASURE30"],
    ["POST", "/changes/:id/measurements/60", "MEASURE60"],
    ["POST", "/changes/:id/measurements/90", "MEASURE90"],
  ];
  for (const [method, path, operation] of definitions)
    app.route({
      method,
      url: `/sites/:siteId/workflow${path}`,
      async handler(request, reply) {
        if (credentials.length === 0)
          return reply
            .code(503)
            .send({ error: "WORKFLOW_ACCESS_NOT_CONFIGURED" });
        const params = paramsSchema.safeParse(request.params);
        if (!params.success)
          return reply.code(400).send({ error: "INVALID_WORKFLOW_PARAMETERS" });
        let p: Principal | undefined;
        try {
          p = await resolvePrincipal(
            request.headers.authorization,
            request.id,
            credentials,
          );
          const output = await service.invoke(
            operation,
            params.data.siteId,
            params.data.id ?? null,
            method === "GET" ? request.query : (request.body ?? {}),
            p,
          );
          if (output === null)
            return reply.code(404).send({ error: "WORKFLOW_RECORD_NOT_FOUND" });
          return reply.code(method === "POST" ? 201 : 200).send(output);
        } catch (error) {
          if (error instanceof z.ZodError)
            return reply.code(400).send({ error: "INVALID_WORKFLOW_REQUEST" });
          if (error instanceof WorkflowError)
            return reply
              .code(
                error.code === "STAFF_AUTH_UNAVAILABLE"
                  ? 503
                  : error.code === "UNAUTHORIZED"
                    ? 401
                    : error.code.includes("FORBIDDEN") ||
                        error.code.includes("ACTOR_REQUIRED")
                      ? 403
                      : 409,
              )
              .send({ error: error.code });
          request.log.error(
            {
              requestId: request.id,
              actorId: p?.actorId,
              errorCode: "WORKFLOW_OPERATION_FAILED",
            },
            "workflow operation failed",
          );
          return reply.code(500).send({ error: "WORKFLOW_OPERATION_FAILED" });
        }
      },
    });
}
