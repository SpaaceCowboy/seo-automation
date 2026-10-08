CREATE TABLE "integration_connection_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"model" text NOT NULL,
	"trigger" text NOT NULL,
	"actor_id" uuid,
	"correlation_id" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"http_status" integer,
	"duration_ms" integer,
	CONSTRAINT "integration_check_status" CHECK ("integration_connection_checks"."status" in ('QUEUED','RUNNING','VERIFIED','FAILED','SUPERSEDED')),
	CONSTRAINT "integration_check_trigger" CHECK ("integration_connection_checks"."trigger" in ('STARTUP','SCHEDULED','MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "integration_runtime" (
	"name" text PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connection_checks" ADD CONSTRAINT "integration_connection_checks_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_checks_instance_latest" ON "integration_connection_checks" USING btree ("instance_id","requested_at");
--> statement-breakpoint
CREATE FUNCTION protect_completed_integration_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('VERIFIED','FAILED','SUPERSEDED') THEN
    RAISE EXCEPTION 'completed integration check history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER integration_check_history_immutable BEFORE UPDATE OR DELETE ON integration_connection_checks FOR EACH ROW EXECUTE FUNCTION protect_completed_integration_check();
