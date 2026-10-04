CREATE TYPE "public"."integration_provider" AS ENUM('GSC', 'GA4', 'PAGESPEED');--> statement-breakpoint
CREATE TYPE "public"."integration_sync_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"property_identifier" text NOT NULL,
	"credential_reference" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "integration_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"account_id" uuid,
	"provider" "integration_provider" NOT NULL,
	"job_type" text NOT NULL,
	"dimension_set" text,
	"start_date" date,
	"end_date" date,
	"status" "integration_sync_status" DEFAULT 'QUEUED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"cursor" text,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"unmatched_url_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"display_query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"query_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "gsc_page_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"page_id" uuid,
	"observed_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"normalized_url_hash" text NOT NULL,
	"normalization_version" text NOT NULL,
	"date" date NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"search_type" text DEFAULT 'web' NOT NULL,
	"data_state" text DEFAULT 'final' NOT NULL,
	"clicks" double precision NOT NULL,
	"impressions" double precision NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "gsc_query_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"date" date NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"search_type" text DEFAULT 'web' NOT NULL,
	"data_state" text DEFAULT 'final' NOT NULL,
	"clicks" double precision NOT NULL,
	"impressions" double precision NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "gsc_page_query_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"page_id" uuid,
	"query_id" uuid NOT NULL,
	"observed_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"normalized_url_hash" text NOT NULL,
	"normalization_version" text NOT NULL,
	"date" date NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"search_type" text DEFAULT 'web' NOT NULL,
	"data_state" text DEFAULT 'final' NOT NULL,
	"clicks" double precision NOT NULL,
	"impressions" double precision NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "ga4_page_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"page_id" uuid,
	"date" date NOT NULL,
	"observed_landing_page" text NOT NULL,
	"normalized_url" text NOT NULL,
	"normalized_url_hash" text NOT NULL,
	"normalization_version" text NOT NULL,
	"channel" text DEFAULT 'Organic Search' NOT NULL,
	"dimension_version" text NOT NULL,
	"sessions" double precision NOT NULL,
	"total_users" double precision NOT NULL,
	"engaged_sessions" double precision NOT NULL,
	"engagement_rate" double precision NOT NULL,
	"key_events" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "pagespeed_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"page_id" uuid,
	"observed_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"normalized_url_hash" text NOT NULL,
	"normalization_version" text NOT NULL,
	"strategy" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"performance_score" double precision,
	"lcp_ms" double precision,
	"inp_ms" double precision,
	"cls" double precision,
	"field_lcp_ms" double precision,
	"field_inp_ms" double precision,
	"field_cls" double precision,
	"field_data_available" boolean NOT NULL,
	"lighthouse_version" text,
	"api_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_daily" ADD CONSTRAINT "gsc_page_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_daily" ADD CONSTRAINT "gsc_page_daily_sync_run_id_integration_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."integration_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_daily" ADD CONSTRAINT "gsc_page_daily_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_daily" ADD CONSTRAINT "gsc_query_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_daily" ADD CONSTRAINT "gsc_query_daily_sync_run_id_integration_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."integration_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_daily" ADD CONSTRAINT "gsc_query_daily_query_id_search_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."search_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_query_daily" ADD CONSTRAINT "gsc_page_query_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_query_daily" ADD CONSTRAINT "gsc_page_query_daily_sync_run_id_integration_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."integration_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_query_daily" ADD CONSTRAINT "gsc_page_query_daily_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_query_daily" ADD CONSTRAINT "gsc_page_query_daily_query_id_search_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."search_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ga4_page_daily" ADD CONSTRAINT "ga4_page_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ga4_page_daily" ADD CONSTRAINT "ga4_page_daily_sync_run_id_integration_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."integration_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ga4_page_daily" ADD CONSTRAINT "ga4_page_daily_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagespeed_snapshots" ADD CONSTRAINT "pagespeed_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagespeed_snapshots" ADD CONSTRAINT "pagespeed_snapshots_sync_run_id_integration_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."integration_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagespeed_snapshots" ADD CONSTRAINT "pagespeed_snapshots_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_accounts_site_provider_property_unique" ON "integration_accounts" USING btree ("site_id","provider","property_identifier");--> statement-breakpoint
CREATE INDEX "integration_accounts_site_provider_index" ON "integration_accounts" USING btree ("site_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_runs_idempotency_unique" ON "integration_sync_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_sync_runs_site_provider_created_index" ON "integration_sync_runs" USING btree ("site_id","provider","created_at");--> statement-breakpoint
CREATE INDEX "integration_sync_runs_status_index" ON "integration_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "search_queries_site_hash_unique" ON "search_queries" USING btree ("site_id","query_hash");--> statement-breakpoint
CREATE INDEX "search_queries_site_normalized_index" ON "search_queries" USING btree ("site_id","normalized_query");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_page_daily_natural_unique" ON "gsc_page_daily" USING btree ("site_id","date","normalized_url_hash","country","device","search_type","data_state");--> statement-breakpoint
CREATE INDEX "gsc_page_daily_site_date_page_index" ON "gsc_page_daily" USING btree ("site_id","date","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_query_daily_natural_unique" ON "gsc_query_daily" USING btree ("site_id","date","query_id","country","device","search_type","data_state");--> statement-breakpoint
CREATE INDEX "gsc_query_daily_site_date_query_index" ON "gsc_query_daily" USING btree ("site_id","date","query_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_page_query_daily_natural_unique" ON "gsc_page_query_daily" USING btree ("site_id","date","normalized_url_hash","query_id","country","device","search_type","data_state");--> statement-breakpoint
CREATE INDEX "gsc_page_query_daily_site_date_page_query_index" ON "gsc_page_query_daily" USING btree ("site_id","date","page_id","query_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ga4_page_daily_natural_unique" ON "ga4_page_daily" USING btree ("site_id","date","normalized_url_hash","channel","dimension_version");--> statement-breakpoint
CREATE INDEX "ga4_page_daily_site_date_page_index" ON "ga4_page_daily" USING btree ("site_id","date","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pagespeed_snapshots_observation_unique" ON "pagespeed_snapshots" USING btree ("site_id","normalized_url_hash","strategy","collected_at");--> statement-breakpoint
CREATE INDEX "pagespeed_snapshots_site_page_strategy_index" ON "pagespeed_snapshots" USING btree ("site_id","page_id","strategy","collected_at");
