import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  Proposal,
  MeasurementSample,
  MeasurementOutcome,
  ChangeValues,
  Role,
} from "@roco/workflow";
import { sites, pages, actors, opportunities, agentOutputs } from "./schema.js";
export const recommendationState = pgEnum("recommendation_state", [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "CHANGES_REQUESTED",
  "IMPLEMENTED",
  "CANCELLED",
]);
export const workflowMode = pgEnum("workflow_mode", ["SANDBOX", "PRODUCTION"]);
export const recommendationRisk = pgEnum("recommendation_risk", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "SPECIAL_APPROVAL",
]);
export const measurementState = pgEnum("measurement_result_state", [
  "POSITIVE",
  "NEUTRAL",
  "NEGATIVE",
  "INSUFFICIENT_DATA",
  "REVERTED",
]);
export const measurementRunState = pgEnum("measurement_run_state", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id),
    agentOutputId: uuid("agent_output_id")
      .notNull()
      .references(() => agentOutputs.id),
    actionIndex: integer("action_index").notNull(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id),
    changeType: text("change_type").notNull(),
    mode: workflowMode("mode").notNull(),
    state: recommendationState("state").notNull().default("DRAFT"),
    currentVersionId: uuid("current_version_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => actors.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("recommendations_site_key_unique").on(
      t.siteId,
      t.idempotencyKey,
    ),
    uniqueIndex("recommendations_source_action_mode_unique").on(
      t.agentOutputId,
      t.actionIndex,
      t.mode,
    ),
    index("recommendations_site_state_index").on(t.siteId, t.state),
    index("recommendations_page_index").on(t.pageId),
  ],
);
export const recommendationVersions = pgTable(
  "recommendation_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id),
    number: integer("number").notNull(),
    proposal: jsonb("proposal").$type<Proposal>().notNull(),
    risk: recommendationRisk("risk").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => actors.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("recommendation_versions_number_unique").on(
      t.recommendationId,
      t.number,
    ),
  ],
);
export const recommendationEvents = pgTable(
  "recommendation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => recommendationVersions.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    action: text("action").notNull(),
    fromState: recommendationState("from_state"),
    toState: recommendationState("to_state").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recommendation_events_history_index").on(
      t.recommendationId,
      t.createdAt,
    ),
  ],
);
export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => recommendationVersions.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    decision: text("decision").notNull(),
    reviewerRoles: jsonb("reviewer_roles").$type<Role[]>().notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_decisions_approved_version_unique")
      .on(t.versionId)
      .where(sql`${t.decision} = 'APPROVED'`),
  ],
);
export const changeLedgerEntries = pgTable(
  "change_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => recommendationVersions.id),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvalDecisions.id),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id),
    mode: workflowMode("mode").notNull(),
    beforeValues: jsonb("before_values").$type<ChangeValues>().notNull(),
    afterValues: jsonb("after_values").$type<ChangeValues>().notNull(),
    implementedBy: uuid("implemented_by")
      .notNull()
      .references(() => actors.id),
    implementedAt: timestamp("implemented_at", {
      withTimezone: true,
    }).notNull(),
    notes: text("notes").notNull(),
    externalReference: text("external_reference").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("change_ledger_entries_version_unique").on(t.versionId),
    uniqueIndex("change_ledger_entries_site_key_unique").on(
      t.siteId,
      t.idempotencyKey,
    ),
    index("change_ledger_entries_page_time_index").on(
      t.pageId,
      t.implementedAt,
    ),
  ],
);
export const changeEvents = pgTable(
  "change_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    changeId: uuid("change_id")
      .notNull()
      .references(() => changeLedgerEntries.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    type: text("type").notNull(),
    values: jsonb("values").$type<ChangeValues | null>(),
    reason: text("reason").notNull(),
    note: text("note"),
    externalReference: text("external_reference"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    uniqueIndex("change_events_key_unique").on(t.changeId, t.idempotencyKey),
    uniqueIndex("change_events_revert_unique")
      .on(t.changeId)
      .where(sql`${t.type} = 'REVERT'`),
  ],
);
export const changeBaselines = pgTable(
  "change_baselines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    changeId: uuid("change_id")
      .notNull()
      .references(() => changeLedgerEntries.id),
    number: integer("number").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    sample: jsonb("sample").$type<MeasurementSample>().notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("change_baselines_version_unique").on(t.changeId, t.number),
    uniqueIndex("change_baselines_key_unique").on(t.changeId, t.idempotencyKey),
  ],
);
export const measurementPlans = pgTable(
  "measurement_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    changeId: uuid("change_id")
      .notNull()
      .references(() => changeLedgerEntries.id),
    initialBaselineId: uuid("initial_baseline_id")
      .notNull()
      .references(() => changeBaselines.id),
    horizon: integer("horizon").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }).notNull(),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("measurement_plans_horizon_unique").on(t.changeId, t.horizon),
    index("measurement_plans_due_index").on(t.nextCheckAt),
    check("measurement_plans_horizon_check", sql`${t.horizon} in (30,60,90)`),
  ],
);
export const measurementRuns = pgTable(
  "measurement_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => measurementPlans.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: measurementRunState("status").notNull().default("QUEUED"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("measurement_runs_plan_key_unique").on(
      t.planId,
      t.idempotencyKey,
    ),
    index("measurement_runs_status_index").on(t.status),
  ],
);
export const measurementResults = pgTable(
  "measurement_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => measurementRuns.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => measurementPlans.id),
    baselineId: uuid("baseline_id")
      .notNull()
      .references(() => changeBaselines.id),
    state: measurementState("state").notNull(),
    outcome: jsonb("outcome").$type<MeasurementOutcome>().notNull(),
    comparison: jsonb("comparison").$type<MeasurementSample>().notNull(),
    overlapIds: jsonb("overlap_ids").$type<string[]>().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("measurement_results_run_unique").on(t.runId),
    index("measurement_results_plan_time_index").on(t.planId, t.measuredAt),
  ],
);
