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
  Candidate,
  EngineInput,
  EngineResult,
  OpportunityConfig,
} from "@roco/opportunities";
import { pages, sites, searchQueries } from "./schema.js";

export const opportunityType = pgEnum("opportunity_type", [
  "QUICK_WIN",
  "CTR",
  "DECAY",
  "CANNIBALIZATION_CANDIDATE",
  "INTERNAL_LINK",
  "CONTENT_GAP_CANDIDATE",
]);
export const opportunityStatus = pgEnum("opportunity_status", [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DISMISSED",
  "STALE",
]);
export const opportunityRunStatus = pgEnum("opportunity_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export const scoringConfigs = pgTable(
  "scoring_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    contentHash: text("content_hash").notNull(),
    version: text("version").notNull(),
    configuration: jsonb("configuration").$type<OpportunityConfig>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("scoring_configs_site_hash_unique").on(t.siteId, t.contentHash),
  ],
);
export const opportunityRuns = pgTable(
  "opportunity_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    configId: uuid("config_id")
      .notNull()
      .references(() => scoringConfigs.id),
    idempotencyKey: text("idempotency_key").notNull(),
    detectorVersion: text("detector_version").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: opportunityRunStatus("status").notNull().default("QUEUED"),
    correlationId: text("correlation_id").notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<EngineInput>(),
    statistics: jsonb("statistics").$type<
      EngineResult["statistics"] & {
        created: number;
        updated: number;
        resolved: number;
        staled: number;
        projectionSkipped: boolean;
        durationMs: number;
      }
    >(),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("opportunity_runs_site_key_unique").on(
      t.siteId,
      t.idempotencyKey,
    ),
    index("opportunity_runs_site_end_index").on(
      t.siteId,
      t.endDate,
      t.createdAt,
    ),
    check("opportunity_runs_window_check", sql`${t.startDate} <= ${t.endDate}`),
  ],
);
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    fingerprint: text("fingerprint").notNull(),
    type: opportunityType("type").notNull(),
    status: opportunityStatus("status").notNull().default("OPEN"),
    pageId: uuid("page_id").references(() => pages.id),
    queryId: uuid("query_id").references(() => searchQueries.id),
    url: text("url"),
    score: doublePrecision("score").notNull(),
    lastRunId: uuid("last_run_id")
      .notNull()
      .references(() => opportunityRuns.id),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunities_site_fingerprint_unique").on(
      t.siteId,
      t.fingerprint,
    ),
    index("opportunities_site_status_score_index").on(
      t.siteId,
      t.status,
      t.score,
    ),
    index("opportunities_site_type_index").on(t.siteId, t.type),
    index("opportunities_page_index").on(t.pageId),
    check(
      "opportunities_score_check",
      sql`${t.score} >= 0 and ${t.score} <= 100`,
    ),
  ],
);
export const opportunityScores = pgTable(
  "opportunity_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => opportunityRuns.id),
    configId: uuid("config_id")
      .notNull()
      .references(() => scoringConfigs.id),
    score: doublePrecision("score").notNull(),
    observation: jsonb("observation").$type<Candidate>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunity_scores_run_opportunity_unique").on(
      t.runId,
      t.opportunityId,
    ),
    index("opportunity_scores_opportunity_index").on(
      t.opportunityId,
      t.createdAt,
    ),
    check(
      "opportunity_scores_score_check",
      sql`${t.score} >= 0 and ${t.score} <= 100`,
    ),
  ],
);
export const opportunityEvents = pgTable(
  "opportunity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => opportunityRuns.id),
    fromStatus: opportunityStatus("from_status"),
    toStatus: opportunityStatus("to_status").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunity_events_run_opportunity_unique").on(
      t.runId,
      t.opportunityId,
    ),
  ],
);
