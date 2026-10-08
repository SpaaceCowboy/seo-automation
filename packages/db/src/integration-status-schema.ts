import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
  check,
} from "drizzle-orm/pg-core";
import { actors } from "./schema.js";

export const integrationRuntime = pgTable("integration_runtime", {
  name: text("name").primaryKey(),
  instanceId: uuid("instance_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true })
    .notNull()
    .defaultNow(),
  healthy: boolean("healthy").notNull().default(true),
});
export const integrationConnectionChecks = pgTable(
  "integration_connection_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id").notNull(),
    model: text("model").notNull(),
    trigger: text("trigger").notNull(),
    actorId: uuid("actor_id").references(() => actors.id),
    correlationId: text("correlation_id").notNull(),
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("integration_checks_instance_latest").on(t.instanceId, t.requestedAt),
    check(
      "integration_check_status",
      sql`${t.status} in ('QUEUED','RUNNING','VERIFIED','FAILED','SUPERSEDED')`,
    ),
    check(
      "integration_check_trigger",
      sql`${t.trigger} in ('STARTUP','SCHEDULED','MANUAL')`,
    ),
  ],
);
