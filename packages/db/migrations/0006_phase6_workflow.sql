CREATE TYPE "public"."measurement_run_state" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."measurement_result_state" AS ENUM('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'INSUFFICIENT_DATA', 'REVERTED');--> statement-breakpoint
CREATE TYPE "public"."recommendation_risk" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'SPECIAL_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."recommendation_state" AS ENUM('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'IMPLEMENTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."workflow_mode" AS ENUM('SANDBOX', 'PRODUCTION');--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reviewer_roles" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"actor_id" uuid NOT NULL,
	"sample" jsonb NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"values" jsonb,
	"reason" text NOT NULL,
	"note" text,
	"external_reference" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"mode" "workflow_mode" NOT NULL,
	"before_values" jsonb NOT NULL,
	"after_values" jsonb NOT NULL,
	"implemented_by" uuid NOT NULL,
	"implemented_at" timestamp with time zone NOT NULL,
	"notes" text NOT NULL,
	"external_reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"initial_baseline_id" uuid NOT NULL,
	"horizon" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"next_check_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_plans_horizon_check" CHECK ("measurement_plans"."horizon" in (30,60,90))
);
--> statement-breakpoint
CREATE TABLE "measurement_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"state" "measurement_result_state" NOT NULL,
	"outcome" jsonb NOT NULL,
	"comparison" jsonb NOT NULL,
	"overlap_ids" jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "measurement_run_state" DEFAULT 'QUEUED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recommendation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_state" "recommendation_state",
	"to_state" "recommendation_state" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"proposal" jsonb NOT NULL,
	"risk" "recommendation_risk" NOT NULL,
	"confidence" double precision NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"agent_output_id" uuid NOT NULL,
	"action_index" integer NOT NULL,
	"page_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"mode" "workflow_mode" NOT NULL,
	"state" "recommendation_state" DEFAULT 'DRAFT' NOT NULL,
	"current_version_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_version_id_recommendation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."recommendation_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_baselines" ADD CONSTRAINT "change_baselines_change_id_change_ledger_entries_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_baselines" ADD CONSTRAINT "change_baselines_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_change_id_change_ledger_entries_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_version_id_recommendation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."recommendation_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_approval_id_approval_decisions_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_implemented_by_actors_id_fk" FOREIGN KEY ("implemented_by") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_plans" ADD CONSTRAINT "measurement_plans_change_id_change_ledger_entries_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_plans" ADD CONSTRAINT "measurement_plans_initial_baseline_id_change_baselines_id_fk" FOREIGN KEY ("initial_baseline_id") REFERENCES "public"."change_baselines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_run_id_measurement_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."measurement_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_plan_id_measurement_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."measurement_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_baseline_id_change_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."change_baselines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_runs" ADD CONSTRAINT "measurement_runs_plan_id_measurement_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."measurement_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_runs" ADD CONSTRAINT "measurement_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_runs" ADD CONSTRAINT "measurement_runs_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_version_id_recommendation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."recommendation_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_versions" ADD CONSTRAINT "recommendation_versions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_versions" ADD CONSTRAINT "recommendation_versions_created_by_actors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_agent_output_id_agent_outputs_id_fk" FOREIGN KEY ("agent_output_id") REFERENCES "public"."agent_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_created_by_actors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_approved_version_unique" ON "approval_decisions" USING btree ("version_id") WHERE "approval_decisions"."decision" = 'APPROVED';--> statement-breakpoint
CREATE UNIQUE INDEX "change_baselines_version_unique" ON "change_baselines" USING btree ("change_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "change_baselines_key_unique" ON "change_baselines" USING btree ("change_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "change_events_key_unique" ON "change_events" USING btree ("change_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "change_events_revert_unique" ON "change_events" USING btree ("change_id") WHERE "change_events"."type" = 'REVERT';--> statement-breakpoint
CREATE UNIQUE INDEX "change_ledger_entries_version_unique" ON "change_ledger_entries" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_ledger_entries_site_key_unique" ON "change_ledger_entries" USING btree ("site_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "change_ledger_entries_page_time_index" ON "change_ledger_entries" USING btree ("page_id","implemented_at");--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_plans_horizon_unique" ON "measurement_plans" USING btree ("change_id","horizon");--> statement-breakpoint
CREATE INDEX "measurement_plans_due_index" ON "measurement_plans" USING btree ("next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_results_run_unique" ON "measurement_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "measurement_results_plan_time_index" ON "measurement_results" USING btree ("plan_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_runs_plan_key_unique" ON "measurement_runs" USING btree ("plan_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "measurement_runs_status_index" ON "measurement_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recommendation_events_history_index" ON "recommendation_events" USING btree ("recommendation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_versions_number_unique" ON "recommendation_versions" USING btree ("recommendation_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_site_key_unique" ON "recommendations" USING btree ("site_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_source_action_mode_unique" ON "recommendations" USING btree ("agent_output_id","action_index","mode");--> statement-breakpoint
CREATE INDEX "recommendations_site_state_index" ON "recommendations" USING btree ("site_id","state");--> statement-breakpoint
CREATE INDEX "recommendations_page_index" ON "recommendations" USING btree ("page_id");--> statement-breakpoint
CREATE TRIGGER recommendation_versions_immutable BEFORE UPDATE OR DELETE ON recommendation_versions FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER recommendation_events_immutable BEFORE UPDATE OR DELETE ON recommendation_events FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_decisions_immutable BEFORE UPDATE OR DELETE ON approval_decisions FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER change_ledger_entries_immutable BEFORE UPDATE OR DELETE ON change_ledger_entries FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER change_events_immutable BEFORE UPDATE OR DELETE ON change_events FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER change_baselines_immutable BEFORE UPDATE OR DELETE ON change_baselines FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER measurement_results_immutable BEFORE UPDATE OR DELETE ON measurement_results FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER recommendations_no_delete BEFORE DELETE ON recommendations FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER measurement_plans_no_delete BEFORE DELETE ON measurement_plans FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER measurement_runs_no_delete BEFORE DELETE ON measurement_runs FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION roco_guard_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec recommendations; ver recommendation_versions;
BEGIN
  SELECT * INTO rec FROM recommendations WHERE id = NEW.recommendation_id;
  SELECT * INTO ver FROM recommendation_versions WHERE id = NEW.version_id;
  IF ver.recommendation_id IS DISTINCT FROM rec.id OR rec.current_version_id IS DISTINCT FROM ver.id THEN
    RAISE EXCEPTION 'Approval must reference the current immutable version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM actors WHERE id=NEW.actor_id AND type='HUMAN' AND disabled_at IS NULL) THEN
    RAISE EXCEPTION 'Approval requires an active human actor';
  END IF;
  IF NEW.decision = 'SUPERSEDED' THEN
    IF rec.state <> 'APPROVED' OR NOT (NEW.reviewer_roles ? 'OPERATOR') THEN RAISE EXCEPTION 'Only an operator revision can supersede approval'; END IF;
    RETURN NEW;
  END IF;
  IF rec.state <> 'READY_FOR_REVIEW' OR NEW.decision NOT IN ('APPROVED','REJECTED','CHANGES_REQUESTED') OR jsonb_typeof(NEW.reviewer_roles) <> 'array' THEN
    RAISE EXCEPTION 'Invalid review decision';
  END IF;
  IF ver.risk IN ('HIGH','SPECIAL_APPROVAL') THEN
    IF NOT (NEW.reviewer_roles ? 'SPECIAL_APPROVER') THEN RAISE EXCEPTION 'Special approver required'; END IF;
  ELSIF NOT (NEW.reviewer_roles ? 'APPROVER' OR NEW.reviewer_roles ? 'SPECIAL_APPROVER') THEN
    RAISE EXCEPTION 'Approver role required';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_decisions_guard BEFORE INSERT ON approval_decisions FOR EACH ROW EXECUTE FUNCTION roco_guard_approval();
--> statement-breakpoint
CREATE FUNCTION roco_guard_recommendation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' OR NEW.current_version_id IS NOT NULL THEN RAISE EXCEPTION 'Recommendation starts as an unapproved draft'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.agent_output_id IS DISTINCT FROM OLD.agent_output_id OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id OR
     NEW.action_index IS DISTINCT FROM OLD.action_index OR NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.change_type IS DISTINCT FROM OLD.change_type OR
     NEW.mode IS DISTINCT FROM OLD.mode OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Recommendation identity is immutable';
  END IF;
  IF NEW.current_version_id IS NULL OR NOT EXISTS (SELECT 1 FROM recommendation_versions WHERE id=NEW.current_version_id AND recommendation_id=NEW.id) THEN RAISE EXCEPTION 'Invalid recommendation version'; END IF;
  IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id AND NEW.state <> 'DRAFT' THEN RAISE EXCEPTION 'A new version requires fresh human approval'; END IF;
  IF NEW.state = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM approval_decisions WHERE version_id=NEW.current_version_id AND decision='APPROVED') THEN RAISE EXCEPTION 'Human approval required'; END IF;
  IF NEW.state = 'IMPLEMENTED' AND NOT EXISTS (SELECT 1 FROM change_ledger_entries WHERE version_id=NEW.current_version_id) THEN RAISE EXCEPTION 'Approved implementation record required'; END IF;
  IF OLD.state IN ('IMPLEMENTED','CANCELLED') AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'Terminal recommendation state cannot be reopened'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recommendations_guard BEFORE INSERT OR UPDATE ON recommendations FOR EACH ROW EXECUTE FUNCTION roco_guard_recommendation();
--> statement-breakpoint
CREATE FUNCTION roco_guard_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec recommendations; ver recommendation_versions; approval approval_decisions;
BEGIN
  SELECT * INTO rec FROM recommendations WHERE id=NEW.recommendation_id;
  SELECT * INTO ver FROM recommendation_versions WHERE id=NEW.version_id;
  SELECT * INTO approval FROM approval_decisions WHERE id=NEW.approval_id;
  IF rec.state <> 'APPROVED' OR rec.current_version_id IS DISTINCT FROM ver.id OR ver.recommendation_id IS DISTINCT FROM rec.id OR
    approval.version_id IS DISTINCT FROM ver.id OR approval.decision <> 'APPROVED' OR NEW.site_id IS DISTINCT FROM rec.site_id OR NEW.page_id IS DISTINCT FROM rec.page_id OR NEW.mode IS DISTINCT FROM rec.mode THEN
    RAISE EXCEPTION 'Current approved version is required for ledger recording';
  END IF;
  IF NEW.before_values IS DISTINCT FROM ver.proposal->'before' OR NEW.after_values IS DISTINCT FROM ver.proposal->'after' THEN RAISE EXCEPTION 'Implementation values must match approval'; END IF;
  IF NEW.implemented_at < approval.created_at OR NEW.implemented_at > NEW.recorded_at OR NOT EXISTS(SELECT 1 FROM actors WHERE id=NEW.implemented_by AND type='HUMAN' AND disabled_at IS NULL) THEN RAISE EXCEPTION 'Invalid human implementation metadata'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER change_ledger_entries_guard BEFORE INSERT ON change_ledger_entries FOR EACH ROW EXECUTE FUNCTION roco_guard_ledger();
--> statement-breakpoint
CREATE FUNCTION roco_guard_measurement_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.change_id IS DISTINCT FROM OLD.change_id OR NEW.initial_baseline_id IS DISTINCT FROM OLD.initial_baseline_id OR NEW.horizon IS DISTINCT FROM OLD.horizon OR
    NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.ready_at IS DISTINCT FROM OLD.ready_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Measurement definition is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER measurement_plans_guard BEFORE UPDATE ON measurement_plans FOR EACH ROW EXECUTE FUNCTION roco_guard_measurement_plan();
--> statement-breakpoint
CREATE FUNCTION roco_guard_measurement_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SUCCEEDED' OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
    NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Measurement command and completed run are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER measurement_runs_guard BEFORE UPDATE ON measurement_runs FOR EACH ROW EXECUTE FUNCTION roco_guard_measurement_run();
