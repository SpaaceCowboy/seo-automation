import { z } from "zod";

export const OPENAI_CONNECTION_QUEUE = "integrations.openai.check";
export const agentCodeSchema = z.enum([
  "SUPERVISOR",
  "TECHNICAL",
  "KEYWORD",
  "CONTENT",
  "INTERNAL_LINKING",
]);
const safeModel = z.string().regex(/^(?!sk[-_])[a-zA-Z0-9_.-]{1,100}$/i);
const nanos = z.string().regex(/^\d+$/);
const nullableTime = z.iso.datetime().nullable();
export const runtimeSnapshotSchema = z.strictObject({
  agentsEnabled: z.boolean(),
  policyKnown: z.boolean(),
  agents: z
    .array(
      z.strictObject({
        code: agentCodeSchema,
        enabled: z.boolean(),
        model: safeModel.nullable(),
        reasoning: z.string().max(20).nullable(),
      }),
    )
    .length(5),
  openai: z.strictObject({
    keyConfigured: z.boolean(),
    model: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,100}$/)
      .nullable(),
  }),
  google: z.strictObject({
    siteId: z.string().uuid().nullable(),
    GSC: z.boolean(),
    GA4: z.boolean(),
    PAGESPEED: z.boolean(),
  }),
  limits: z.strictObject({
    monthlyNanousd: nanos.nullable(),
    runNanousd: nanos.nullable(),
    minScore: z.number().min(0).max(100).nullable(),
  }),
});
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;
export const connectionJobSchema = z.strictObject({
  checkId: z.string().uuid(),
  instanceId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
});
export const connectionStateSchema = z.enum([
  "NOT_CHECKED",
  "NOT_CONFIGURED",
  "QUEUED",
  "RUNNING",
  "VERIFIED",
  "FAILED",
  "STALE",
]);
export const integrationsStatusSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  worker: z.strictObject({
    state: z.enum(["UNKNOWN", "ONLINE", "OFFLINE", "UNHEALTHY"]),
    lastSeen: nullableTime,
  }),
  agents: z
    .array(
      z.strictObject({
        code: agentCodeSchema,
        enabled: z.boolean().nullable(),
        model: safeModel.nullable(),
        reasoning: z.string().nullable(),
      }),
    )
    .length(5),
  openai: z.strictObject({
    configured: z.boolean().nullable(),
    model: safeModel.nullable(),
    status: connectionStateSchema,
    lastChecked: nullableTime,
    errorCode: z.string().max(80).nullable(),
    httpStatus: z.number().int().nullable(),
    durationMs: z.number().int().nullable(),
    checkId: z.string().uuid().nullable(),
    canCheck: z.boolean(),
    cooldownSeconds: z.number().int().min(0),
  }),
  budget: z.strictObject({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    limitNanousd: nanos.nullable(),
    bookedNanousd: nanos,
    remainingNanousd: nanos.nullable(),
    runNanousd: nanos.nullable(),
    minScore: z.number().nullable(),
  }),
  google: z
    .array(
      z.strictObject({
        provider: z.enum(["GSC", "GA4", "PAGESPEED"]),
        configured: z.boolean().nullable(),
        scheduledForSelectedSite: z.boolean().nullable(),
        latestAttempt: z
          .strictObject({
            status: z.string(),
            at: z.iso.datetime(),
            errorCode: z.string().nullable(),
            dimensionSet: z.string().nullable(),
          })
          .nullable(),
        lastSuccess: nullableTime,
      }),
    )
    .length(3),
});
export type IntegrationsStatus = z.infer<typeof integrationsStatusSchema>;
