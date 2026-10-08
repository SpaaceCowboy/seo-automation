import { sql } from "drizzle-orm";
import {
  boolean,
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

export const siteStatus = pgEnum("site_status", ["ACTIVE", "DISABLED"]);
export const actorType = pgEnum("actor_type", ["HUMAN", "SERVICE"]);
export const jobStatus = pgEnum("job_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
export const crawlRunStatus = pgEnum("crawl_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIAL",
]);
export const crawlTrigger = pgEnum("crawl_trigger", [
  "MANUAL",
  "SCHEDULED",
  "RETRY",
]);
export const fetchStatus = pgEnum("fetch_status", [
  "SUCCESS",
  "HTTP_ERROR",
  "TIMEOUT",
  "TOO_LARGE",
  "REDIRECT_LOOP",
  "REDIRECT_LIMIT",
  "BLOCKED",
  "NETWORK_ERROR",
]);
export const analysisStatus = pgEnum("analysis_status", [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
export const issueSeverity = pgEnum("issue_severity", [
  "INFO",
  "WARNING",
  "ERROR",
  "CRITICAL",
]);
export const integrationProvider = pgEnum("integration_provider", [
  "GSC",
  "GA4",
  "PAGESPEED",
]);
export const integrationSyncStatus = pgEnum("integration_sync_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
]);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    canonicalOrigin: text("canonical_origin").notNull(),
    timezone: text("timezone").notNull(),
    status: siteStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sites_canonical_origin_unique").on(table.canonicalOrigin),
  ],
);

export const siteHosts = pgTable(
  "site_hosts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    includeSubdomains: boolean("include_subdomains").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("site_hosts_site_host_unique").on(table.siteId, table.host),
    index("site_hosts_site_id_index").on(table.siteId),
  ],
);

export const actors = pgTable(
  "actors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: actorType("type").notNull(),
    externalId: text("external_id"),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("actors_external_id_unique")
      .on(table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: jobStatus("status").notNull().default("QUEUED"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    bossJobId: text("boss_job_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    correlationId: text("correlation_id").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("jobs_idempotency_key_unique").on(table.idempotencyKey),
    index("jobs_status_created_at_index").on(table.status, table.createdAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => actors.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_subject_index").on(
      table.subjectType,
      table.subjectId,
      table.createdAt,
    ),
    index("audit_events_correlation_id_index").on(table.correlationId),
  ],
);

export const crawlRuns = pgTable(
  "crawl_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    trigger: crawlTrigger("trigger").notNull().default("MANUAL"),
    status: crawlRunStatus("status").notNull().default("QUEUED"),
    startUrl: text("start_url").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    configSnapshot: jsonb("config_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("crawl_runs_idempotency_key_unique").on(table.idempotencyKey),
    index("crawl_runs_site_created_at_index").on(table.siteId, table.createdAt),
    index("crawl_runs_status_index").on(table.status),
  ],
);

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    normalizedUrl: text("normalized_url").notNull(),
    normalizedUrlHash: text("normalized_url_hash").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pages_site_url_hash_unique").on(
      table.siteId,
      table.normalizedUrlHash,
    ),
    index("pages_site_url_index").on(table.siteId, table.normalizedUrl),
  ],
);

export const pageSnapshots = pgTable(
  "page_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    observedUrl: text("observed_url").notNull(),
    finalUrl: text("final_url"),
    httpStatus: integer("http_status"),
    fetchStatus: fetchStatus("fetch_status").notNull(),
    contentType: text("content_type"),
    responseMs: integer("response_ms").notNull(),
    canonicalUrl: text("canonical_url"),
    metaRobots: jsonb("meta_robots").$type<string[]>().notNull().default([]),
    xRobotsTag: jsonb("x_robots_tag").$type<string[]>().notNull().default([]),
    robotsAllowed: boolean("robots_allowed").notNull(),
    isIndexable: boolean("is_indexable").notNull(),
    indexabilityReason: text("indexability_reason").notNull(),
    title: text("title"),
    metaDescription: text("meta_description"),
    wordCount: integer("word_count").notNull().default(0),
    contentHash: text("content_hash"),
    htmlHash: text("html_hash"),
    renderMode: text("render_mode").notNull().default("HTTP"),
    hasBreadcrumbs: boolean("has_breadcrumbs").notNull().default(false),
    inSitemap: boolean("in_sitemap").notNull().default(false),
    crawlDepth: integer("crawl_depth").notNull(),
    parserVersion: text("parser_version").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("page_snapshots_run_page_unique").on(
      table.crawlRunId,
      table.pageId,
    ),
    index("page_snapshots_page_fetched_index").on(
      table.pageId,
      table.fetchedAt,
    ),
    index("page_snapshots_run_status_index").on(
      table.crawlRunId,
      table.httpStatus,
    ),
  ],
);

export const redirectHops = pgTable(
  "redirect_hops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageSnapshotId: uuid("page_snapshot_id")
      .notNull()
      .references(() => pageSnapshots.id, { onDelete: "cascade" }),
    hopIndex: integer("hop_index").notNull(),
    sourceUrl: text("source_url").notNull(),
    destinationUrl: text("destination_url").notNull(),
    httpStatus: integer("http_status").notNull(),
    responseMs: integer("response_ms").notNull(),
  },
  (table) => [
    uniqueIndex("redirect_hops_snapshot_index_unique").on(
      table.pageSnapshotId,
      table.hopIndex,
    ),
  ],
);

export const headingObservations = pgTable(
  "heading_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageSnapshotId: uuid("page_snapshot_id")
      .notNull()
      .references(() => pageSnapshots.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    position: integer("position").notNull(),
    text: text("text").notNull(),
  },
  (table) => [
    uniqueIndex("heading_observations_snapshot_position_unique").on(
      table.pageSnapshotId,
      table.position,
    ),
  ],
);

export const structuredDataObservations = pgTable(
  "structured_data_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageSnapshotId: uuid("page_snapshot_id")
      .notNull()
      .references(() => pageSnapshots.id, { onDelete: "cascade" }),
    schemaType: text("schema_type").notNull(),
  },
  (table) => [
    uniqueIndex("structured_data_snapshot_type_unique").on(
      table.pageSnapshotId,
      table.schemaType,
    ),
  ],
);

export const imageObservations = pgTable(
  "image_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageSnapshotId: uuid("page_snapshot_id")
      .notNull()
      .references(() => pageSnapshots.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sourceUrl: text("source_url"),
    altText: text("alt_text"),
    hasAltAttribute: boolean("has_alt_attribute").notNull(),
  },
  (table) => [
    uniqueIndex("image_observations_snapshot_position_unique").on(
      table.pageSnapshotId,
      table.position,
    ),
  ],
);

export const linkEdges = pgTable(
  "link_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    sourcePageId: uuid("source_page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    targetPageId: uuid("target_page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    targetUrl: text("target_url").notNull(),
    isInternal: boolean("is_internal").notNull(),
    anchorText: text("anchor_text"),
    rel: text("rel"),
    occurrenceKey: text("occurrence_key").notNull(),
  },
  (table) => [
    uniqueIndex("link_edges_run_occurrence_unique").on(
      table.crawlRunId,
      table.occurrenceKey,
    ),
    index("link_edges_run_source_index").on(
      table.crawlRunId,
      table.sourcePageId,
    ),
    index("link_edges_run_target_index").on(
      table.crawlRunId,
      table.targetPageId,
    ),
  ],
);

export const robotsObservations = pgTable(
  "robots_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    httpStatus: integer("http_status"),
    contentHash: text("content_hash"),
    sitemaps: jsonb("sitemaps").$type<string[]>().notNull().default([]),
    crawlDelaySeconds: integer("crawl_delay_seconds"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("robots_observations_run_unique").on(table.crawlRunId),
  ],
);

export const sitemapFetches = pgTable(
  "sitemap_fetches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    parentUrl: text("parent_url"),
    httpStatus: integer("http_status"),
    contentHash: text("content_hash"),
    documentType: text("document_type").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sitemap_fetches_run_url_unique").on(
      table.crawlRunId,
      table.url,
    ),
  ],
);

export const sitemapEntries = pgTable(
  "sitemap_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    sitemapFetchId: uuid("sitemap_fetch_id")
      .notNull()
      .references(() => sitemapFetches.id, { onDelete: "cascade" }),
    normalizedUrl: text("normalized_url").notNull(),
    pageId: uuid("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    lastModified: text("last_modified"),
  },
  (table) => [
    uniqueIndex("sitemap_entries_fetch_url_unique").on(
      table.sitemapFetchId,
      table.normalizedUrl,
    ),
  ],
);

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    rulesetVersion: text("ruleset_version").notNull(),
    status: analysisStatus("status").notNull().default("RUNNING"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("analysis_runs_crawl_ruleset_unique").on(
      table.crawlRunId,
      table.rulesetVersion,
    ),
  ],
);

export const issueDefinitions = pgTable(
  "issue_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    ruleVersion: text("rule_version").notNull(),
    severity: issueSeverity("severity").notNull(),
    remediation: text("remediation").notNull(),
  },
  (table) => [
    uniqueIndex("issue_definitions_code_version_unique").on(
      table.code,
      table.ruleVersion,
    ),
  ],
);

export const issueOccurrences = pgTable(
  "issue_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisRunId: uuid("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    issueDefinitionId: uuid("issue_definition_id")
      .notNull()
      .references(() => issueDefinitions.id),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("issue_occurrences_analysis_fingerprint_unique").on(
      table.analysisRunId,
      table.fingerprint,
    ),
    index("issue_occurrences_page_index").on(table.pageId, table.detectedAt),
  ],
);

export const pageMetrics = pgTable(
  "page_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    crawlDepth: integer("crawl_depth").notNull(),
    incomingInternalLinks: integer("incoming_internal_links").notNull(),
    outgoingInternalLinks: integer("outgoing_internal_links").notNull(),
    isOrphan: boolean("is_orphan").notNull(),
  },
  (table) => [
    uniqueIndex("page_metrics_run_page_unique").on(
      table.crawlRunId,
      table.pageId,
    ),
    index("page_metrics_run_orphan_index").on(table.crawlRunId, table.isOrphan),
  ],
);

export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    propertyIdentifier: text("property_identifier").notNull(),
    credentialReference: text("credential_reference"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_accounts_site_provider_property_unique").on(
      table.siteId,
      table.provider,
      table.propertyIdentifier,
    ),
    index("integration_accounts_site_provider_index").on(
      table.siteId,
      table.provider,
    ),
  ],
);

export const integrationSyncRuns = pgTable(
  "integration_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => integrationAccounts.id, {
      onDelete: "set null",
    }),
    provider: integrationProvider("provider").notNull(),
    jobType: text("job_type").notNull(),
    dimensionSet: text("dimension_set"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: integrationSyncStatus("status").notNull().default("QUEUED"),
    idempotencyKey: text("idempotency_key").notNull(),
    cursor: text("cursor"),
    rowsRead: integer("rows_read").notNull().default(0),
    rowsWritten: integer("rows_written").notNull().default(0),
    requestCount: integer("request_count").notNull().default(0),
    unmatchedUrlCount: integer("unmatched_url_count").notNull().default(0),
    summary: jsonb("summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_sync_runs_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("integration_sync_runs_site_provider_created_index").on(
      table.siteId,
      table.provider,
      table.createdAt,
    ),
    index("integration_sync_runs_status_index").on(table.status),
  ],
);

export const searchQueries = pgTable(
  "search_queries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    displayQuery: text("display_query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    queryHash: text("query_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("search_queries_site_hash_unique").on(
      table.siteId,
      table.queryHash,
    ),
    index("search_queries_site_normalized_index").on(
      table.siteId,
      table.normalizedQuery,
    ),
  ],
);

export const integrationUnmatchedUrls = pgTable(
  "integration_unmatched_urls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => integrationSyncRuns.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    observedUrl: text("observed_url").notNull(),
    reason: text("reason").notNull(),
    dimensionSet: text("dimension_set"),
    observedDate: date("observed_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_unmatched_urls_run_observation_unique").on(
      table.syncRunId,
      table.provider,
      table.observedUrl,
      table.reason,
    ),
    index("integration_unmatched_urls_site_provider_index").on(
      table.siteId,
      table.provider,
      table.createdAt,
    ),
  ],
);

const googleMetricColumns = {
  date: date("date").notNull(),
  country: text("country").notNull().default(""),
  device: text("device").notNull().default(""),
  searchType: text("search_type").notNull().default("web"),
  dataState: text("data_state").notNull().default("final"),
  clicks: doublePrecision("clicks").notNull(),
  impressions: doublePrecision("impressions").notNull(),
  ctr: doublePrecision("ctr").notNull(),
  position: doublePrecision("position").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const gscPageDaily = pgTable(
  "gsc_page_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => integrationSyncRuns.id),
    pageId: uuid("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    observedUrl: text("observed_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    normalizedUrlHash: text("normalized_url_hash").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    ...googleMetricColumns,
  },
  (table) => [
    uniqueIndex("gsc_page_daily_natural_unique").on(
      table.siteId,
      table.date,
      table.normalizedUrlHash,
      table.country,
      table.device,
      table.searchType,
      table.dataState,
    ),
    index("gsc_page_daily_site_date_page_index").on(
      table.siteId,
      table.date,
      table.pageId,
    ),
  ],
);

export const gscQueryDaily = pgTable(
  "gsc_query_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => integrationSyncRuns.id),
    queryId: uuid("query_id")
      .notNull()
      .references(() => searchQueries.id, { onDelete: "cascade" }),
    ...googleMetricColumns,
  },
  (table) => [
    uniqueIndex("gsc_query_daily_natural_unique").on(
      table.siteId,
      table.date,
      table.queryId,
      table.country,
      table.device,
      table.searchType,
      table.dataState,
    ),
    index("gsc_query_daily_site_date_query_index").on(
      table.siteId,
      table.date,
      table.queryId,
    ),
  ],
);

export const gscPageQueryDaily = pgTable(
  "gsc_page_query_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => integrationSyncRuns.id),
    pageId: uuid("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    queryId: uuid("query_id")
      .notNull()
      .references(() => searchQueries.id, { onDelete: "cascade" }),
    observedUrl: text("observed_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    normalizedUrlHash: text("normalized_url_hash").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    ...googleMetricColumns,
  },
  (table) => [
    uniqueIndex("gsc_page_query_daily_natural_unique").on(
      table.siteId,
      table.date,
      table.normalizedUrlHash,
      table.queryId,
      table.country,
      table.device,
      table.searchType,
      table.dataState,
    ),
    index("gsc_page_query_daily_site_date_page_query_index").on(
      table.siteId,
      table.date,
      table.pageId,
      table.queryId,
    ),
  ],
);

export const ga4PageDaily = pgTable(
  "ga4_page_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => integrationSyncRuns.id),
    pageId: uuid("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    date: date("date").notNull(),
    observedLandingPage: text("observed_landing_page").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    normalizedUrlHash: text("normalized_url_hash").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    channel: text("channel").notNull().default("Organic Search"),
    dimensionVersion: text("dimension_version").notNull(),
    sessions: doublePrecision("sessions").notNull(),
    totalUsers: doublePrecision("total_users").notNull(),
    engagedSessions: doublePrecision("engaged_sessions").notNull(),
    engagementRate: doublePrecision("engagement_rate").notNull(),
    keyEvents: doublePrecision("key_events").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ga4_page_daily_natural_unique").on(
      table.siteId,
      table.date,
      table.normalizedUrlHash,
      table.channel,
      table.dimensionVersion,
    ),
    index("ga4_page_daily_site_date_page_index").on(
      table.siteId,
      table.date,
      table.pageId,
    ),
  ],
);

export const pagespeedSnapshots = pgTable(
  "pagespeed_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => integrationSyncRuns.id),
    pageId: uuid("page_id").references(() => pages.id, {
      onDelete: "set null",
    }),
    observedUrl: text("observed_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    normalizedUrlHash: text("normalized_url_hash").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    strategy: text("strategy").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    performanceScore: doublePrecision("performance_score"),
    lcpMs: doublePrecision("lcp_ms"),
    inpMs: doublePrecision("inp_ms"),
    cls: doublePrecision("cls"),
    fieldLcpMs: doublePrecision("field_lcp_ms"),
    fieldInpMs: doublePrecision("field_inp_ms"),
    fieldCls: doublePrecision("field_cls"),
    fieldDataAvailable: boolean("field_data_available").notNull(),
    lighthouseVersion: text("lighthouse_version"),
    apiVersion: text("api_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pagespeed_snapshots_observation_unique").on(
      table.siteId,
      table.normalizedUrlHash,
      table.strategy,
      table.collectedAt,
    ),
    index("pagespeed_snapshots_site_page_strategy_index").on(
      table.siteId,
      table.pageId,
      table.strategy,
      table.collectedAt,
    ),
  ],
);

export * from "./opportunity-schema.js";
export * from "./agent-schema.js";
export * from "./workflow-schema.js";
