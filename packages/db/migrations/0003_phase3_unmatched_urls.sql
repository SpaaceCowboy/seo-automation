CREATE TABLE "integration_unmatched_urls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"observed_url" text NOT NULL,
	"reason" text NOT NULL,
	"dimension_set" text,
	"observed_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "integration_unmatched_urls" ADD CONSTRAINT "integration_unmatched_urls_sync_run_id_integration_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."integration_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_unmatched_urls" ADD CONSTRAINT "integration_unmatched_urls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_unmatched_urls_run_observation_unique" ON "integration_unmatched_urls" USING btree ("sync_run_id","provider","observed_url","reason");--> statement-breakpoint
CREATE INDEX "integration_unmatched_urls_site_provider_index" ON "integration_unmatched_urls" USING btree ("site_id","provider","created_at");
