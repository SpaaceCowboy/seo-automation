CREATE TYPE "public"."analysis_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."crawl_run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."crawl_trigger" AS ENUM('MANUAL', 'SCHEDULED', 'RETRY');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('SUCCESS', 'HTTP_ERROR', 'TIMEOUT', 'TOO_LARGE', 'REDIRECT_LOOP', 'REDIRECT_LIMIT', 'BLOCKED', 'NETWORK_ERROR');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL');--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"ruleset_version" text NOT NULL,
	"status" "analysis_status" DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"trigger" "crawl_trigger" DEFAULT 'MANUAL' NOT NULL,
	"status" "crawl_run_status" DEFAULT 'QUEUED' NOT NULL,
	"start_url" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"summary" jsonb,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heading_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_snapshot_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_snapshot_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_url" text,
	"alt_text" text,
	"has_alt_attribute" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"rule_version" text NOT NULL,
	"severity" "issue_severity" NOT NULL,
	"remediation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"issue_definition_id" uuid NOT NULL,
	"page_id" uuid,
	"fingerprint" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid,
	"target_url" text NOT NULL,
	"is_internal" boolean NOT NULL,
	"anchor_text" text,
	"rel" text,
	"occurrence_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"crawl_depth" integer NOT NULL,
	"incoming_internal_links" integer NOT NULL,
	"outgoing_internal_links" integer NOT NULL,
	"is_orphan" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"observed_url" text NOT NULL,
	"final_url" text,
	"http_status" integer,
	"fetch_status" "fetch_status" NOT NULL,
	"content_type" text,
	"response_ms" integer NOT NULL,
	"canonical_url" text,
	"meta_robots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"x_robots_tag" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"robots_allowed" boolean NOT NULL,
	"is_indexable" boolean NOT NULL,
	"indexability_reason" text NOT NULL,
	"title" text,
	"meta_description" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"html_hash" text,
	"render_mode" text DEFAULT 'HTTP' NOT NULL,
	"has_breadcrumbs" boolean DEFAULT false NOT NULL,
	"in_sitemap" boolean DEFAULT false NOT NULL,
	"crawl_depth" integer NOT NULL,
	"parser_version" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"normalized_url" text NOT NULL,
	"normalized_url_hash" text NOT NULL,
	"normalization_version" text NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirect_hops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_snapshot_id" uuid NOT NULL,
	"hop_index" integer NOT NULL,
	"source_url" text NOT NULL,
	"destination_url" text NOT NULL,
	"http_status" integer NOT NULL,
	"response_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "robots_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"url" text NOT NULL,
	"http_status" integer,
	"content_hash" text,
	"sitemaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"crawl_delay_seconds" integer,
	"error_code" text,
	"error_message" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sitemap_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"sitemap_fetch_id" uuid NOT NULL,
	"normalized_url" text NOT NULL,
	"page_id" uuid,
	"last_modified" text
);
--> statement-breakpoint
CREATE TABLE "sitemap_fetches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"url" text NOT NULL,
	"parent_url" text,
	"http_status" integer,
	"content_hash" text,
	"document_type" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structured_data_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_snapshot_id" uuid NOT NULL,
	"schema_type" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heading_observations" ADD CONSTRAINT "heading_observations_page_snapshot_id_page_snapshots_id_fk" FOREIGN KEY ("page_snapshot_id") REFERENCES "public"."page_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_observations" ADD CONSTRAINT "image_observations_page_snapshot_id_page_snapshots_id_fk" FOREIGN KEY ("page_snapshot_id") REFERENCES "public"."page_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_occurrences" ADD CONSTRAINT "issue_occurrences_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_occurrences" ADD CONSTRAINT "issue_occurrences_issue_definition_id_issue_definitions_id_fk" FOREIGN KEY ("issue_definition_id") REFERENCES "public"."issue_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_occurrences" ADD CONSTRAINT "issue_occurrences_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_edges" ADD CONSTRAINT "link_edges_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_edges" ADD CONSTRAINT "link_edges_source_page_id_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_edges" ADD CONSTRAINT "link_edges_target_page_id_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_metrics" ADD CONSTRAINT "page_metrics_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_metrics" ADD CONSTRAINT "page_metrics_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect_hops" ADD CONSTRAINT "redirect_hops_page_snapshot_id_page_snapshots_id_fk" FOREIGN KEY ("page_snapshot_id") REFERENCES "public"."page_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robots_observations" ADD CONSTRAINT "robots_observations_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_sitemap_fetch_id_sitemap_fetches_id_fk" FOREIGN KEY ("sitemap_fetch_id") REFERENCES "public"."sitemap_fetches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitemap_fetches" ADD CONSTRAINT "sitemap_fetches_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structured_data_observations" ADD CONSTRAINT "structured_data_observations_page_snapshot_id_page_snapshots_id_fk" FOREIGN KEY ("page_snapshot_id") REFERENCES "public"."page_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_crawl_ruleset_unique" ON "analysis_runs" USING btree ("crawl_run_id","ruleset_version");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_runs_idempotency_key_unique" ON "crawl_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "crawl_runs_site_created_at_index" ON "crawl_runs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "crawl_runs_status_index" ON "crawl_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "heading_observations_snapshot_position_unique" ON "heading_observations" USING btree ("page_snapshot_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "image_observations_snapshot_position_unique" ON "image_observations" USING btree ("page_snapshot_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_definitions_code_version_unique" ON "issue_definitions" USING btree ("code","rule_version");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_occurrences_analysis_fingerprint_unique" ON "issue_occurrences" USING btree ("analysis_run_id","fingerprint");--> statement-breakpoint
CREATE INDEX "issue_occurrences_page_index" ON "issue_occurrences" USING btree ("page_id","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "link_edges_run_occurrence_unique" ON "link_edges" USING btree ("crawl_run_id","occurrence_key");--> statement-breakpoint
CREATE INDEX "link_edges_run_source_index" ON "link_edges" USING btree ("crawl_run_id","source_page_id");--> statement-breakpoint
CREATE INDEX "link_edges_run_target_index" ON "link_edges" USING btree ("crawl_run_id","target_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_metrics_run_page_unique" ON "page_metrics" USING btree ("crawl_run_id","page_id");--> statement-breakpoint
CREATE INDEX "page_metrics_run_orphan_index" ON "page_metrics" USING btree ("crawl_run_id","is_orphan");--> statement-breakpoint
CREATE UNIQUE INDEX "page_snapshots_run_page_unique" ON "page_snapshots" USING btree ("crawl_run_id","page_id");--> statement-breakpoint
CREATE INDEX "page_snapshots_page_fetched_index" ON "page_snapshots" USING btree ("page_id","fetched_at");--> statement-breakpoint
CREATE INDEX "page_snapshots_run_status_index" ON "page_snapshots" USING btree ("crawl_run_id","http_status");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_site_url_hash_unique" ON "pages" USING btree ("site_id","normalized_url_hash");--> statement-breakpoint
CREATE INDEX "pages_site_url_index" ON "pages" USING btree ("site_id","normalized_url");--> statement-breakpoint
CREATE UNIQUE INDEX "redirect_hops_snapshot_index_unique" ON "redirect_hops" USING btree ("page_snapshot_id","hop_index");--> statement-breakpoint
CREATE UNIQUE INDEX "robots_observations_run_unique" ON "robots_observations" USING btree ("crawl_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sitemap_entries_fetch_url_unique" ON "sitemap_entries" USING btree ("sitemap_fetch_id","normalized_url");--> statement-breakpoint
CREATE UNIQUE INDEX "sitemap_fetches_run_url_unique" ON "sitemap_fetches" USING btree ("crawl_run_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "structured_data_snapshot_type_unique" ON "structured_data_observations" USING btree ("page_snapshot_id","schema_type");