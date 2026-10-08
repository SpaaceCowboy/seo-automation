CREATE TYPE "public"."agent_run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "agent_budget_months" (
	"month" text PRIMARY KEY NOT NULL,
	"limit_nanousd" numeric(30, 0) NOT NULL,
	"booked_nanousd" numeric(30, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_budget_months_nonnegative" CHECK ("agent_budget_months"."booked_nanousd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"bundle" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_type" text NOT NULL,
	"budget_month" text NOT NULL,
	"attempt" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'RUNNING' NOT NULL,
	"reserved_nanousd" numeric(30, 0) NOT NULL,
	"cost_nanousd" numeric(30, 0),
	"cost_basis" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"provider_request_id" text,
	"http_status" integer,
	"error_code" text,
	"retryable" boolean,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_invocations_cost_check" CHECK ("agent_invocations"."reserved_nanousd" >= 0 and ("agent_invocations"."cost_nanousd" is null or "agent_invocations"."cost_nanousd" >= 0))
);
--> statement-breakpoint
CREATE TABLE "agent_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"analysis" jsonb NOT NULL,
	"draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"score_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'QUEUED' NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"policy_snapshot" jsonb,
	"budget_month" text,
	"booked_nanousd" numeric(30, 0) DEFAULT '0' NOT NULL,
	"invocation_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_runs_budget_check" CHECK ("agent_runs"."booked_nanousd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_evidence" ADD CONSTRAINT "agent_evidence_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_invocations" ADD CONSTRAINT "agent_invocations_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_invocation_id_agent_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."agent_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_score_id_opportunity_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."opportunity_scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_evidence_run_unique" ON "agent_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_invocations_run_step_attempt_unique" ON "agent_invocations" USING btree ("run_id","agent_type","attempt");--> statement-breakpoint
CREATE INDEX "agent_invocations_run_index" ON "agent_invocations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_outputs_invocation_unique" ON "agent_outputs" USING btree ("invocation_id");--> statement-breakpoint
CREATE INDEX "agent_outputs_run_index" ON "agent_outputs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_site_key_unique" ON "agent_runs" USING btree ("site_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_runs_opportunity_created_index" ON "agent_runs" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE TRIGGER agent_evidence_immutable BEFORE UPDATE OR DELETE ON agent_evidence FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_runs_no_delete BEFORE DELETE ON agent_runs FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_invocations_no_delete BEFORE DELETE ON agent_invocations FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_outputs_no_delete BEFORE DELETE ON agent_outputs FOR EACH ROW EXECUTE FUNCTION roco_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION roco_guard_agent_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SUCCEEDED' OR NEW.site_id IS DISTINCT FROM OLD.site_id OR
    NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id OR NEW.score_id IS DISTINCT FROM OLD.score_id OR
    NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
    NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version OR
    NEW.schema_version IS DISTINCT FROM OLD.schema_version OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
    (OLD.policy_snapshot IS NOT NULL AND NEW.policy_snapshot IS DISTINCT FROM OLD.policy_snapshot) THEN
    RAISE EXCEPTION 'Agent command, policy and completed result are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_runs_guard BEFORE UPDATE ON agent_runs FOR EACH ROW EXECUTE FUNCTION roco_guard_agent_run();
--> statement-breakpoint
CREATE FUNCTION roco_guard_agent_invocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'RUNNING' OR NEW.run_id IS DISTINCT FROM OLD.run_id OR
    NEW.agent_type IS DISTINCT FROM OLD.agent_type OR NEW.attempt IS DISTINCT FROM OLD.attempt OR
    NEW.provider IS DISTINCT FROM OLD.provider OR NEW.model IS DISTINCT FROM OLD.model OR
    NEW.prompt_version IS DISTINCT FROM OLD.prompt_version OR NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
    NEW.budget_month IS DISTINCT FROM OLD.budget_month OR NEW.input_hash IS DISTINCT FROM OLD.input_hash OR
    NEW.reserved_nanousd IS DISTINCT FROM OLD.reserved_nanousd OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Agent call identity and terminal usage are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_invocations_guard BEFORE UPDATE ON agent_invocations FOR EACH ROW EXECUTE FUNCTION roco_guard_agent_invocation();
--> statement-breakpoint
CREATE FUNCTION roco_guard_agent_output() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.draft IS NOT NULL OR NEW.analysis IS DISTINCT FROM OLD.analysis OR
    NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.invocation_id IS DISTINCT FROM OLD.invocation_id OR
    NEW.schema_version IS DISTINCT FROM OLD.schema_version OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.draft IS NULL OR NEW.draft->>'status' IS DISTINCT FROM 'DRAFT' OR
    NEW.draft->>'executable' IS DISTINCT FROM 'false' OR NEW.draft->'analysis' IS DISTINCT FROM OLD.analysis OR
    OLD.analysis->>'agent' IS DISTINCT FROM 'SUPERVISOR' THEN
    RAISE EXCEPTION 'Validated agent output is immutable and only a matching non-executable draft can be attached once';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_outputs_guard BEFORE UPDATE ON agent_outputs FOR EACH ROW EXECUTE FUNCTION roco_guard_agent_output();
