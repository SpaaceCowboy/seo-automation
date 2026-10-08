import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AgentPolicy,
  Analysis,
  Draft,
  EvidenceBundle,
} from "@roco/agents";
import { actors, opportunities, opportunityScores, sites } from "./schema.js";
export const agentRunStatus = pgEnum("agent_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id),
    scoreId: uuid("score_id")
      .notNull()
      .references(() => opportunityScores.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: text("correlation_id").notNull(),
    status: agentRunStatus("status").notNull().default("QUEUED"),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<AgentPolicy>(),
    budgetMonth: text("budget_month"),
    bookedNanousd: numeric("booked_nanousd", { precision: 30, scale: 0 })
      .notNull()
      .default("0"),
    invocationCount: integer("invocation_count").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_runs_site_key_unique").on(t.siteId, t.idempotencyKey),
    index("agent_runs_opportunity_created_index").on(
      t.opportunityId,
      t.createdAt,
    ),
    check("agent_runs_budget_check", sql`${t.bookedNanousd} >= 0`),
  ],
);
export const agentEvidence = pgTable(
  "agent_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),
    version: text("version").notNull(),
    contentHash: text("content_hash").notNull(),
    bundle: jsonb("bundle").$type<EvidenceBundle>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("agent_evidence_run_unique").on(t.runId)],
);
export const agentInvocations = pgTable(
  "agent_invocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),
    agentType: text("agent_type").notNull(),
    budgetMonth: text("budget_month").notNull(),
    attempt: integer("attempt").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    inputHash: text("input_hash").notNull(),
    status: agentRunStatus("status").notNull().default("RUNNING"),
    reservedNanousd: numeric("reserved_nanousd", {
      precision: 30,
      scale: 0,
    }).notNull(),
    costNanousd: numeric("cost_nanousd", { precision: 30, scale: 0 }),
    costBasis: text("cost_basis"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    providerRequestId: text("provider_request_id"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    retryable: boolean("retryable"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_invocations_run_step_attempt_unique").on(
      t.runId,
      t.agentType,
      t.attempt,
    ),
    index("agent_invocations_run_index").on(t.runId),
    check(
      "agent_invocations_cost_check",
      sql`${t.reservedNanousd} >= 0 and (${t.costNanousd} is null or ${t.costNanousd} >= 0)`,
    ),
  ],
);
export const agentOutputs = pgTable(
  "agent_outputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),
    invocationId: uuid("invocation_id")
      .notNull()
      .references(() => agentInvocations.id),
    schemaVersion: text("schema_version").notNull(),
    analysis: jsonb("analysis").$type<Analysis>().notNull(),
    draft: jsonb("draft").$type<Draft>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_outputs_invocation_unique").on(t.invocationId),
    index("agent_outputs_run_index").on(t.runId),
  ],
);
export const agentBudgetMonths = pgTable(
  "agent_budget_months",
  {
    month: text("month").primaryKey(),
    limitNanousd: numeric("limit_nanousd", {
      precision: 30,
      scale: 0,
    }).notNull(),
    bookedNanousd: numeric("booked_nanousd", { precision: 30, scale: 0 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("agent_budget_months_nonnegative", sql`${t.bookedNanousd} >= 0`),
  ],
);
