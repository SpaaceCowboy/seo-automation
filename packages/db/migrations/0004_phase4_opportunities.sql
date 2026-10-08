CREATE TYPE "public"."opportunity_run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'STALE');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('QUICK_WIN', 'CTR', 'DECAY', 'CANNIBALIZATION_CANDIDATE', 'INTERNAL_LINK', 'CONTENT_GAP_CANDIDATE');--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"type" "opportunity_type" NOT NULL,
	"status" "opportunity_status" DEFAULT 'OPEN' NOT NULL,
	"page_id" uuid,
	"query_id" uuid,
	"url" text,
	"score" double precision NOT NULL,
	"last_run_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_score_check" CHECK ("opportunities"."score" >= 0 and "opportunities"."score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "opportunity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"from_status" "opportunity_status",
	"to_status" "opportunity_status" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"config_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"detector_version" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "opportunity_run_status" DEFAULT 'QUEUED' NOT NULL,
	"correlation_id" text NOT NULL,
	"input_snapshot" jsonb,
	"statistics" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "opportunity_runs_window_check" CHECK ("opportunity_runs"."start_date" <= "opportunity_runs"."end_date")
);
--> statement-breakpoint
CREATE TABLE "opportunity_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"config_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"observation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_scores_score_check" CHECK ("opportunity_scores"."score" >= 0 and "opportunity_scores"."score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "scoring_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"version" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_query_id_search_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."search_queries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_last_run_id_opportunity_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."opportunity_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_events" ADD CONSTRAINT "opportunity_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_events" ADD CONSTRAINT "opportunity_events_run_id_opportunity_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."opportunity_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_runs" ADD CONSTRAINT "opportunity_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_runs" ADD CONSTRAINT "opportunity_runs_config_id_scoring_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."scoring_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_run_id_opportunity_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."opportunity_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_config_id_scoring_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."scoring_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_configs" ADD CONSTRAINT "scoring_configs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_site_fingerprint_unique" ON "opportunities" USING btree ("site_id","fingerprint");--> statement-breakpoint
CREATE INDEX "opportunities_site_status_score_index" ON "opportunities" USING btree ("site_id","status","score");--> statement-breakpoint
CREATE INDEX "opportunities_site_type_index" ON "opportunities" USING btree ("site_id","type");--> statement-breakpoint
CREATE INDEX "opportunities_page_index" ON "opportunities" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_events_run_opportunity_unique" ON "opportunity_events" USING btree ("run_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_runs_site_key_unique" ON "opportunity_runs" USING btree ("site_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "opportunity_runs_site_end_index" ON "opportunity_runs" USING btree ("site_id","end_date","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_scores_run_opportunity_unique" ON "opportunity_scores" USING btree ("run_id","opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunity_scores_opportunity_index" ON "opportunity_scores" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_configs_site_hash_unique" ON "scoring_configs" USING btree ("site_id","content_hash");
--> statement-breakpoint
CREATE FUNCTION roco_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical observations and published configurations are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scoring_configs_immutable BEFORE UPDATE OR DELETE ON scoring_configs FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER opportunity_scores_immutable BEFORE UPDATE OR DELETE ON opportunity_scores FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER opportunity_events_immutable BEFORE UPDATE OR DELETE ON opportunity_events FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION roco_guard_opportunity_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SUCCEEDED' OR
    (OLD.input_snapshot IS NOT NULL AND NEW.input_snapshot IS DISTINCT FROM OLD.input_snapshot) OR
    NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.config_id IS DISTINCT FROM OLD.config_id OR
    NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR
    NEW.detector_version IS DISTINCT FROM OLD.detector_version OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Opportunity run command and captured evidence are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER opportunity_run_guard BEFORE UPDATE ON opportunity_runs FOR EACH ROW EXECUTE FUNCTION roco_guard_opportunity_run();
--> statement-breakpoint
CREATE TRIGGER opportunity_runs_no_delete BEFORE DELETE ON opportunity_runs FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
