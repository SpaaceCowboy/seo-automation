import Fastify from "fastify";

import { resolveCorrelationId, type Logger } from "@roco/shared";

export interface ReadinessStatus { 
    readonly database: boolean;
    readonly queue: boolean;
}

export interface AppDependencies {
    readonly logger: Logger;
    readonly readiness: () => Promise<ReadinessStatus>; 
}

const healthResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["status", "service", "timestamp"],
    properties: {
      status: { type: "string" },
      service: { type: "string" },
      timestamp: { type: "string" },
    },
  } as const;
  
  const readinessResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["status", "services", "timestamp"],
    properties: {
      status: { type: "string" },
      services: {
        type: "object",
        additionalProperties: false,
        required: ["database", "queue"],
        properties: {
          database: { type: "boolean" },
          queue: { type: "boolean" },
        },
      },
      timestamp: { type: "string" },
    },
  } as const;

export function buildApp(dependencies: AppDependencies) {
    const app = Fastify({
        loggerInstance: dependencies.logger,
        genReqId(request) {
            return resolveCorrelationId(request.headers["x-correlation-id"]);
        }
    })
    
    app.setErrorHandler((error, request, replay) => {
        request.log.error({ err: error, requestId: request.id}, "request failed");
        void replay.code(500).send({
            error: "INTENAL_SERVER_ERROR",
            message: "the request could not be completed",
            requestId: request.id
        })
    })

    app.get("/health", {
        schema: {
            response: { 200: healthResponseSchema},
        }
    },
    () => ({
        status: "ok",
        service: "roco-seo-api",
        timestamp: new Date().toISOString(),
    }) 
)
    app.get("/ready", {
        schema: {
            response: { 
                200: readinessResponseSchema,
                503: readinessResponseSchema,
            }
        }
    }, 
    async (_request, reply) => {
        const services = await dependencies.readiness();
        const ready = services.database && services.queue;
        return reply.code(ready ? 200 : 503).send({
            status: ready ? "ready" : "not_ready",
            services,
            timestamps: new Date().toISOString(),
        })
    }
)

    return app;
}