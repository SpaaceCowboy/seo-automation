import { and, asc, desc, eq, gte, lte, isNull, sql } from "drizzle-orm";
import {
  WorkflowError,
  requireRole,
  remeasureSchema,
  classifyMeasurement,
  type Principal,
} from "@roco/workflow";
import {
  assertWorkflowActor,
  auditWorkflow,
  type WorkflowDatabase,
} from "./workflow-repository.js";
import { captureMeasurement } from "./measurement-source.js";
import * as s from "./schema.js";
export function createMeasurementRepository(
  db: WorkflowDatabase,
  clock: () => Date = () => new Date(),
) {
  return {
    async createRun(
      siteId: string,
      changeId: string,
      horizon: 30 | 60 | 90,
      raw: unknown,
      p: Principal,
      scheduled = false,
    ) {
      if (!scheduled) requireRole(p, "OPERATOR");
      const input = remeasureSchema.parse(raw);
      const now = clock();
      return db.transaction(async (tx) => {
        await assertWorkflowActor(tx, p.actorId, !scheduled);
        if (scheduled) {
          const actor = (
            await tx.select().from(s.actors).where(eq(s.actors.id, p.actorId))
          )[0];
          if (actor?.type !== "SERVICE")
            throw new WorkflowError(
              "ACTIVE_MEASUREMENT_SERVICE_ACTOR_REQUIRED",
            );
        }
        const change = (
          await tx
            .select()
            .from(s.changeLedgerEntries)
            .where(
              and(
                eq(s.changeLedgerEntries.id, changeId),
                eq(s.changeLedgerEntries.siteId, siteId),
              ),
            )
        )[0];
        if (!change) throw new WorkflowError("CHANGE_NOT_FOUND");
        const plan = (
          await tx
            .select()
            .from(s.measurementPlans)
            .where(
              and(
                eq(s.measurementPlans.changeId, changeId),
                eq(s.measurementPlans.horizon, horizon),
              ),
            )
            .for("update")
        )[0];
        if (!plan || now < plan.readyAt)
          throw new WorkflowError("MEASUREMENT_NOT_READY");
        const existing = (
          await tx
            .select()
            .from(s.measurementRuns)
            .where(
              and(
                eq(s.measurementRuns.planId, plan.id),
                eq(s.measurementRuns.idempotencyKey, input.idempotencyKey),
              ),
            )
        )[0];
        if (existing) return existing;
        const run = (
          await tx
            .insert(s.measurementRuns)
            .values({
              planId: plan.id,
              siteId,
              actorId: p.actorId,
              correlationId: p.correlationId,
              idempotencyKey: input.idempotencyKey,
              createdAt: now,
            })
            .returning()
        )[0]!;
        await auditWorkflow(
          tx,
          p,
          "workflow.measurement.queued",
          "measurement_run",
          run.id,
          now,
          { planId: plan.id, horizon },
        );
        return run;
      });
    },
    async due() {
      const now = clock();
      return db
        .select({ plan: s.measurementPlans, change: s.changeLedgerEntries })
        .from(s.measurementPlans)
        .innerJoin(
          s.changeLedgerEntries,
          eq(s.changeLedgerEntries.id, s.measurementPlans.changeId),
        )
        .where(
          and(
            isNull(s.measurementPlans.completedAt),
            lte(s.measurementPlans.nextCheckAt, now),
            lte(s.measurementPlans.readyAt, now),
          ),
        )
        .orderBy(
          asc(s.measurementPlans.nextCheckAt),
          asc(s.measurementPlans.id),
        )
        .limit(100);
    },
    async pending() {
      return db
        .select()
        .from(s.measurementRuns)
        .where(eq(s.measurementRuns.status, "QUEUED"))
        .orderBy(asc(s.measurementRuns.createdAt))
        .limit(100);
    },
    async getRun(id: string) {
      return (
        (
          await db
            .select()
            .from(s.measurementRuns)
            .where(eq(s.measurementRuns.id, id))
        )[0] ?? null
      );
    },
    async measure(id: string) {
      const started = clock();
      await db
        .update(s.measurementRuns)
        .set({
          status: "RUNNING",
          startedAt: started,
          finishedAt: null,
          errorCode: null,
          attemptCount: sql`${s.measurementRuns.attemptCount}+1`,
        })
        .where(
          and(
            eq(s.measurementRuns.id, id),
            sql`${s.measurementRuns.status} <> 'SUCCEEDED'`,
          ),
        );
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        const run = (
          await tx
            .select()
            .from(s.measurementRuns)
            .where(eq(s.measurementRuns.id, id))
            .for("update")
        )[0];
        if (!run) throw new WorkflowError("MEASUREMENT_RUN_NOT_FOUND");
        const prior = (
          await tx
            .select()
            .from(s.measurementResults)
            .where(eq(s.measurementResults.runId, id))
        )[0];
        if (prior) return prior;
        await assertWorkflowActor(tx, run.actorId, false);
        const plan = (
          await tx
            .select()
            .from(s.measurementPlans)
            .where(eq(s.measurementPlans.id, run.planId))
            .for("update")
        )[0]!;
        const change = (
          await tx
            .select()
            .from(s.changeLedgerEntries)
            .where(eq(s.changeLedgerEntries.id, plan.changeId))
            .for("update")
        )[0]!;
        if (change.siteId !== run.siteId || clock() < plan.readyAt)
          throw new WorkflowError("MEASUREMENT_NOT_READY");
        const version = (
          await tx
            .select()
            .from(s.recommendationVersions)
            .where(eq(s.recommendationVersions.id, change.versionId))
        )[0]!;
        const baseline = (
          await tx
            .select()
            .from(s.changeBaselines)
            .where(eq(s.changeBaselines.changeId, change.id))
            .orderBy(desc(s.changeBaselines.number))
            .limit(1)
        )[0]!;
        const now = clock();
        const comparison = await captureMeasurement(tx, {
          siteId: change.siteId,
          pageId: change.pageId,
          startDate: plan.startDate,
          endDate: plan.endDate,
          rule: version.proposal.rule,
          now,
        });
        const reverted = (
          await tx
            .select()
            .from(s.changeEvents)
            .where(
              and(
                eq(s.changeEvents.changeId, change.id),
                eq(s.changeEvents.type, "REVERT"),
              ),
            )
            .limit(1)
        )[0];
        const others = await tx
          .select({ id: s.changeLedgerEntries.id })
          .from(s.changeLedgerEntries)
          .where(
            and(
              eq(s.changeLedgerEntries.siteId, change.siteId),
              eq(s.changeLedgerEntries.pageId, change.pageId),
              eq(s.changeLedgerEntries.mode, change.mode),
              sql`${s.changeLedgerEntries.id} <> ${change.id}`,
              gte(
                s.changeLedgerEntries.implementedAt,
                new Date(`${baseline.sample.startDate}T00:00:00Z`),
              ),
              lte(
                s.changeLedgerEntries.implementedAt,
                new Date(`${plan.endDate}T23:59:59Z`),
              ),
            ),
          )
          .limit(1001);
        if (others.length > 1000)
          throw new WorkflowError("OVERLAP_BUDGET_EXCEEDED");
        const overlapIds = others.map((o) => o.id);
        const outcome = classifyMeasurement({
          baseline: baseline.sample,
          comparison,
          rule: version.proposal.rule,
          overlapIds,
          reverted: reverted !== undefined,
          identityChanged: ["URL_CHANGE", "REDIRECT", "DELETE"].includes(
            version.proposal.changeType,
          ),
        });
        const result = (
          await tx
            .insert(s.measurementResults)
            .values({
              runId: id,
              planId: plan.id,
              baselineId: baseline.id,
              state: outcome.state,
              outcome,
              comparison,
              overlapIds,
              actorId: run.actorId,
              measuredAt: now,
            })
            .returning()
        )[0]!;
        const stillWaiting =
          outcome.state === "INSUFFICIENT_DATA" &&
          now.getTime() <
            plan.readyAt.getTime() +
              version.proposal.rule.retryWindowDays * 86400000;
        await tx
          .update(s.measurementPlans)
          .set({
            completedAt: plan.completedAt ?? (stillWaiting ? null : now),
            nextCheckAt: new Date(now.getTime() + 86400000),
          })
          .where(eq(s.measurementPlans.id, plan.id));
        await tx
          .update(s.measurementRuns)
          .set({ status: "SUCCEEDED", finishedAt: now, errorCode: null })
          .where(eq(s.measurementRuns.id, id));
        const p: Principal = {
          actorId: run.actorId,
          roles: [],
          correlationId: run.correlationId,
        };
        await auditWorkflow(
          tx,
          p,
          "workflow.measurement.executed",
          "measurement_run",
          id,
          now,
          { planId: plan.id, baselineId: baseline.id, resultId: result.id },
        );
        await auditWorkflow(
          tx,
          p,
          "workflow.measurement.classified",
          "change",
          change.id,
          now,
          {
            resultId: result.id,
            state: outcome.state,
            horizon: plan.horizon,
            causationClaimed: false,
          },
        );
        return result;
      });
    },
    async fail(id: string, code: string) {
      await db
        .update(s.measurementRuns)
        .set({ status: "FAILED", errorCode: code, finishedAt: clock() })
        .where(
          and(
            eq(s.measurementRuns.id, id),
            sql`${s.measurementRuns.status} <> 'SUCCEEDED'`,
          ),
        );
    },
    async history(siteId: string, changeId: string, p: Principal) {
      requireRole(p, "READ");
      await assertWorkflowActor(db, p.actorId, false);
      const change = (
        await db
          .select()
          .from(s.changeLedgerEntries)
          .where(
            and(
              eq(s.changeLedgerEntries.id, changeId),
              eq(s.changeLedgerEntries.siteId, siteId),
            ),
          )
      )[0];
      if (!change) return null;
      const plans = await db
        .select()
        .from(s.measurementPlans)
        .where(eq(s.measurementPlans.changeId, changeId));
      const results = await db
        .select({
          result: s.measurementResults,
          run: s.measurementRuns,
          plan: s.measurementPlans,
        })
        .from(s.measurementResults)
        .innerJoin(
          s.measurementRuns,
          eq(s.measurementRuns.id, s.measurementResults.runId),
        )
        .innerJoin(
          s.measurementPlans,
          eq(s.measurementPlans.id, s.measurementResults.planId),
        )
        .where(eq(s.measurementPlans.changeId, changeId))
        .orderBy(
          desc(s.measurementResults.measuredAt),
          desc(s.measurementResults.id),
        )
        .limit(100);
      return { plans, results, historyLimit: 100 };
    },
  };
}
export type MeasurementRepository = ReturnType<
  typeof createMeasurementRepository
>;
