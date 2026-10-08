import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  AGENT_SCHEMA_VERSION,
  EVIDENCE_VERSION,
  PROMPT_VERSION,
  AgentError,
  agentTypeSchema,
  analysisSchema,
  buildEvidence,
  selectSpecialists,
  draftSchema,
  evidenceSchema,
  policySchema,
  getAgentRoute,
  type Analysis,
  type AgentPolicy,
  type Draft,
  type EvidenceBundle,
  type WorkflowJournal,
  type PageContext,
} from "@roco/agents";
import * as schema from "./schema.js";
const {
  agentRuns,
  agentEvidence,
  agentInvocations,
  agentOutputs,
  agentBudgetMonths,
  opportunities,
  opportunityScores,
  opportunityRuns,
  pages,
  pageSnapshots,
  searchQueries,
  issueOccurrences,
  issueDefinitions,
  analysisRuns,
  actors,
  auditEvents,
} = schema;
type Run = typeof agentRuns.$inferSelect;
type Database = NodePgDatabase<typeof schema>;
export interface AgentRepository {
  createRun(
    this: void,
    input: {
      siteId: string;
      opportunityId: string;
      actorId: string;
      correlationId: string;
      idempotencyKey?: string | undefined;
    },
  ): Promise<Run>;
  retry(
    this: void,
    input: {
      siteId: string;
      runId: string;
      actorId: string;
      correlationId: string;
    },
  ): Promise<Run>;
  getRun(this: void, id: string): Promise<Run | null>;
  inspect(this: void, siteId: string, id: string): Promise<unknown>;
  draft(this: void, siteId: string, id: string): Promise<Draft | null>;
  withRunLock(
    this: void,
    id: string,
    work: () => Promise<void>,
  ): Promise<boolean>;
  start(
    this: void,
    id: string,
    policy: AgentPolicy,
  ): Promise<{ run: Run; bundle: EvidenceBundle; policy: AgentPolicy } | null>;
  journal(this: void, id: string): WorkflowJournal;
  complete(this: void, id: string, draft: Draft | null): Promise<void>;
  fail(this: void, id: string, code: string): Promise<void>;
}
export function createAgentRepository(
  db: Database,
  pool: Pool,
): AgentRepository {
  return {
    async createRun(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`agent-create:${input.siteId}`}))`,
        );
        const actor = (
          await tx
            .select()
            .from(actors)
            .where(
              and(
                eq(actors.id, input.actorId),
                sql`${actors.disabledAt} is null`,
              ),
            )
        )[0];
        if (!actor) throw new AgentError("ACTIVE_OPERATOR_REQUIRED");
        const opportunity = (
          await tx
            .select()
            .from(opportunities)
            .where(
              and(
                eq(opportunities.id, input.opportunityId),
                eq(opportunities.siteId, input.siteId),
              ),
            )
        )[0];
        if (
          !opportunity ||
          !["OPEN", "ACKNOWLEDGED"].includes(opportunity.status)
        )
          throw new AgentError("OPPORTUNITY_NOT_ANALYZABLE");
        const score = (
          await tx
            .select({ score: opportunityScores })
            .from(opportunityScores)
            .innerJoin(
              opportunityRuns,
              eq(opportunityRuns.id, opportunityScores.runId),
            )
            .where(eq(opportunityScores.opportunityId, opportunity.id))
            .orderBy(
              desc(opportunityRuns.endDate),
              desc(opportunityRuns.createdAt),
              desc(opportunityScores.createdAt),
              desc(opportunityScores.id),
            )
            .limit(1)
        )[0]?.score;
        if (!score) throw new AgentError("OPPORTUNITY_EVIDENCE_UNAVAILABLE");
        const key =
          input.idempotencyKey ??
          `analyze:${score.id}:${PROMPT_VERSION}:${AGENT_SCHEMA_VERSION}`;
        const existing = (
          await tx
            .select()
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.siteId, input.siteId),
                eq(agentRuns.idempotencyKey, key),
              ),
            )
        )[0];
        if (existing) {
          if (
            existing.opportunityId !== input.opportunityId ||
            existing.scoreId !== score.id ||
            existing.actorId !== input.actorId
          )
            throw new AgentError("ANALYSIS_IDEMPOTENCY_CONFLICT");
          return existing;
        }
        const sourceRun = (
          await tx
            .select()
            .from(opportunityRuns)
            .where(eq(opportunityRuns.id, score.runId))
        )[0]!;
        const candidate = score.observation;
        const groupPages =
          (candidate.evidence.pages as
            { pageId?: string | null }[] | undefined) ?? [];
        const sources =
          (candidate.evidence.sources as { pageId?: string }[] | undefined) ??
          [];
        const pageIds = [
          ...new Set(
            [
              candidate.pageId,
              ...groupPages.map((p) => p.pageId),
              ...sources.map((p) => p.pageId),
            ].filter((p): p is string => typeof p === "string"),
          ),
        ].slice(0, 5);
        // Page-pair overlap evidence can list URLs instead of page IDs. Resolve only against this site's identities.
        const urls =
          (candidate.evidence.pages as unknown[] | undefined)
            ?.filter((p): p is string => typeof p === "string")
            .slice(0, 5) ?? [];
        const matched = urls.length
          ? await tx
              .select({ id: pages.id })
              .from(pages)
              .where(
                and(
                  eq(pages.siteId, input.siteId),
                  inArray(pages.normalizedUrl, urls),
                ),
              )
              .limit(5)
          : [];
        for (const p of matched)
          if (!pageIds.includes(p.id) && pageIds.length < 5) pageIds.push(p.id);
        const pageRows = pageIds.length
          ? await tx
              .select()
              .from(pages)
              .where(
                and(eq(pages.siteId, input.siteId), inArray(pages.id, pageIds)),
              )
              .orderBy(asc(pages.id))
          : [];
        const crawlId = sourceRun.inputSnapshot?.crawl?.id;
        const snapshots =
          pageIds.length && crawlId
            ? await tx
                .select()
                .from(pageSnapshots)
                .where(
                  and(
                    eq(pageSnapshots.crawlRunId, crawlId),
                    inArray(pageSnapshots.pageId, pageIds),
                  ),
                )
                .orderBy(asc(pageSnapshots.id))
            : [];
        const pageContext: PageContext[] = pageRows.map((p) => {
          const snapshot = snapshots.find((s) => s.pageId === p.id);
          return {
            id: p.id,
            url: p.normalizedUrl,
            snapshotId: snapshot?.id ?? null,
            fields: snapshot
              ? {
                  title: snapshot.title,
                  metaDescription: snapshot.metaDescription,
                  canonicalUrl: snapshot.canonicalUrl,
                  isIndexable: snapshot.isIndexable,
                  indexabilityReason: snapshot.indexabilityReason,
                  httpStatus: snapshot.httpStatus,
                  wordCount: snapshot.wordCount,
                }
              : {},
          };
        });
        const groupQueries =
          (candidate.evidence.queryIds as string[] | undefined) ?? [];
        const queryIds = [
          ...new Set(
            [candidate.queryId, ...groupQueries].filter(
              (id): id is string => typeof id === "string",
            ),
          ),
        ].slice(0, 10);
        const queries = queryIds.length
          ? await tx
              .select({
                id: searchQueries.id,
                text: searchQueries.displayQuery,
              })
              .from(searchQueries)
              .where(
                and(
                  eq(searchQueries.siteId, input.siteId),
                  inArray(searchQueries.id, queryIds),
                ),
              )
              .orderBy(asc(searchQueries.id))
          : [];
        const issues =
          pageIds.length && crawlId
            ? await tx
                .select({
                  id: issueOccurrences.id,
                  code: issueDefinitions.code,
                })
                .from(issueOccurrences)
                .innerJoin(
                  issueDefinitions,
                  eq(issueDefinitions.id, issueOccurrences.issueDefinitionId),
                )
                .innerJoin(
                  analysisRuns,
                  eq(analysisRuns.id, issueOccurrences.analysisRunId),
                )
                .where(
                  and(
                    eq(analysisRuns.crawlRunId, crawlId),
                    inArray(issueOccurrences.pageId, pageIds),
                  ),
                )
                .orderBy(asc(issueOccurrences.id))
                .limit(10)
            : [];
        const sourceTruncated =
          new Set(
            [
              candidate.pageId,
              ...groupPages.map((p) => p.pageId),
              ...sources.map((p) => p.pageId),
            ].filter((p) => typeof p === "string"),
          ).size > 5 ||
          groupQueries.length > 10 ||
          ((candidate.evidence.pages as unknown[] | undefined)?.length ?? 0) >
            5 ||
          issues.length > 10;
        const bundle = buildEvidence({
          siteId: input.siteId,
          opportunityId: opportunity.id,
          scoreId: score.id,
          candidate,
          pages: pageContext,
          queries,
          issues,
          sourceTruncated,
        });
        const run = (
          await tx
            .insert(agentRuns)
            .values({
              siteId: input.siteId,
              opportunityId: input.opportunityId,
              scoreId: score.id,
              actorId: input.actorId,
              idempotencyKey: key,
              correlationId: input.correlationId,
              promptVersion: PROMPT_VERSION,
              schemaVersion: AGENT_SCHEMA_VERSION,
            })
            .returning()
        )[0]!;
        await tx.insert(agentEvidence).values({
          runId: run.id,
          version: EVIDENCE_VERSION,
          contentHash: createHash("sha256")
            .update(JSON.stringify(bundle))
            .digest("hex"),
          bundle,
        });
        await tx.insert(auditEvents).values({
          actorId: input.actorId,
          action: "agent.analysis.queued",
          subjectType: "agent_run",
          subjectId: run.id,
          correlationId: input.correlationId,
          metadata: { opportunityId: input.opportunityId, scoreId: score.id },
        });
        return run;
      });
    },
    async retry(input) {
      return db.transaction(async (tx) => {
        const existing = (
          await tx
            .select()
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.id, input.runId),
                eq(agentRuns.siteId, input.siteId),
              ),
            )
        )[0];
        if (
          !existing ||
          existing.status !== "FAILED" ||
          existing.actorId !== input.actorId
        )
          throw new AgentError("AGENT_RETRY_NOT_ALLOWED");
        const actor = (
          await tx
            .select()
            .from(actors)
            .where(
              and(
                eq(actors.id, input.actorId),
                sql`${actors.disabledAt} is null`,
              ),
            )
        )[0];
        if (!actor) throw new AgentError("ACTIVE_OPERATOR_REQUIRED");
        const calls = await tx
          .select()
          .from(agentInvocations)
          .where(eq(agentInvocations.runId, input.runId));
        if (
          calls.some(
            (call) => call.status === "FAILED" && call.retryable === false,
          )
        )
          throw new AgentError("AGENT_NONRETRYABLE_FAILURE_CREATE_NEW_RUN");
        if (existing.policySnapshot) {
          const limit =
            policySchema.parse(existing.policySnapshot).retryLimit + 1;
          for (const agent of agentTypeSchema.options) {
            const steps = calls.filter((call) => call.agentType === agent);
            if (
              steps.length >= limit &&
              !steps.some((call) => call.status === "SUCCEEDED")
            )
              throw new AgentError("AGENT_ATTEMPTS_EXHAUSTED_CREATE_NEW_RUN");
          }
        }
        await tx.insert(auditEvents).values({
          actorId: input.actorId,
          action: "agent.analysis.retry.queued",
          subjectType: "agent_run",
          subjectId: existing.id,
          correlationId: input.correlationId,
          metadata: { originalCorrelationId: existing.correlationId },
        });
        return (
          await tx
            .update(agentRuns)
            .set({ status: "QUEUED", errorCode: null, finishedAt: null })
            .where(eq(agentRuns.id, existing.id))
            .returning()
        )[0]!;
      });
    },
    async getRun(id) {
      return (
        (await db.select().from(agentRuns).where(eq(agentRuns.id, id)))[0] ??
        null
      );
    },
    async inspect(siteId, id) {
      const run = (
        await db
          .select()
          .from(agentRuns)
          .where(and(eq(agentRuns.id, id), eq(agentRuns.siteId, siteId)))
      )[0];
      if (!run) return null;
      const evidence = (
        await db.select().from(agentEvidence).where(eq(agentEvidence.runId, id))
      )[0];
      const calls = await db
        .select()
        .from(agentInvocations)
        .where(eq(agentInvocations.runId, id))
        .orderBy(asc(agentInvocations.startedAt), asc(agentInvocations.id));
      const outputs = await db
        .select()
        .from(agentOutputs)
        .where(eq(agentOutputs.runId, id))
        .orderBy(asc(agentOutputs.createdAt), asc(agentOutputs.id));
      return { ...run, evidence, calls, outputs };
    },
    async draft(siteId, id) {
      const run = (
        await db
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, id),
              eq(agentRuns.siteId, siteId),
              eq(agentRuns.status, "SUCCEEDED"),
            ),
          )
      )[0];
      if (!run) return null;
      const output = (
        await db
          .select()
          .from(agentOutputs)
          .where(
            and(
              eq(agentOutputs.runId, id),
              sql`${agentOutputs.draft} is not null`,
            ),
          )
          .limit(1)
      )[0];
      return output?.draft ? draftSchema.parse(output.draft) : null;
    },
    async withRunLock(id, work) {
      const client = await pool.connect();
      let locked = false;
      try {
        const result = await client.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtext($1)) locked",
          [`agent-run:${id}`],
        );
        locked = result.rows[0]?.locked === true;
        if (!locked) return false;
        await work();
        return true;
      } finally {
        try {
          if (locked)
            await client.query("select pg_advisory_unlock(hashtext($1))", [
              `agent-run:${id}`,
            ]);
        } finally {
          client.release();
        }
      }
    },
    async start(id, rawPolicy) {
      const incoming = policySchema.parse(rawPolicy);
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('agent-monthly-budget'))`,
        );
        const run = (
          await tx
            .select()
            .from(agentRuns)
            .where(eq(agentRuns.id, id))
            .for("update")
        )[0];
        if (!run || run.status === "SUCCEEDED") return null;
        const actor = (
          await tx
            .select()
            .from(actors)
            .where(
              and(
                eq(actors.id, run.actorId),
                sql`${actors.disabledAt} is null`,
              ),
            )
        )[0];
        if (!actor) throw new AgentError("ACTIVE_OPERATOR_REQUIRED");
        if (
          run.promptVersion !== PROMPT_VERSION ||
          run.schemaVersion !== AGENT_SCHEMA_VERSION
        )
          throw new AgentError("AGENT_VERSION_CHANGED_CREATE_NEW_RUN");
        const policy = run.policySnapshot
          ? policySchema.parse(run.policySnapshot)
          : incoming;
        if (policy.executionMode !== incoming.executionMode)
          throw new AgentError("AGENT_EXECUTION_MODE_CHANGED_CREATE_NEW_RUN");
        const sourceScore = (
          await tx
            .select({ score: opportunityScores.score })
            .from(opportunityScores)
            .where(eq(opportunityScores.id, run.scoreId))
        )[0];
        if (
          !sourceScore ||
          sourceScore.score <
            Math.max(policy.minOpportunityScore, incoming.minOpportunityScore)
        )
          throw new AgentError("OPPORTUNITY_BELOW_AI_PRIORITY_THRESHOLD");
        const month = new Date().toISOString().slice(0, 7);
        await tx
          .insert(agentBudgetMonths)
          .values({
            month,
            limitNanousd: String(incoming.monthlyBudgetNanousd),
          })
          .onConflictDoNothing();
        const monthly = (
          await tx
            .select()
            .from(agentBudgetMonths)
            .where(eq(agentBudgetMonths.month, month))
            .for("update")
        )[0]!;
        const activeCap = BigInt(incoming.monthlyBudgetNanousd);
        if (activeCap < BigInt(monthly.limitNanousd))
          await tx
            .update(agentBudgetMonths)
            .set({ limitNanousd: activeCap.toString(), updatedAt: new Date() })
            .where(eq(agentBudgetMonths.month, month));
        const evidence = (
          await tx
            .select()
            .from(agentEvidence)
            .where(eq(agentEvidence.runId, id))
        )[0];
        if (!evidence) throw new AgentError("AGENT_EVIDENCE_UNAVAILABLE");
        await tx
          .update(agentRuns)
          .set({
            status: "RUNNING",
            policySnapshot: policy,
            budgetMonth:
              run.budgetMonth ?? new Date().toISOString().slice(0, 7),
            attemptCount: sql`${agentRuns.attemptCount}+1`,
            startedAt: run.startedAt ?? new Date(),
            finishedAt: null,
            errorCode: null,
          })
          .where(eq(agentRuns.id, id));
        return { run, bundle: evidenceSchema.parse(evidence.bundle), policy };
      });
    },
    journal(runId) {
      return {
        async calls(agent) {
          const calls = await db
            .select()
            .from(agentInvocations)
            .where(
              and(
                eq(agentInvocations.runId, runId),
                eq(agentInvocations.agentType, agent),
              ),
            )
            .orderBy(asc(agentInvocations.attempt));
          const outputs = await db
            .select()
            .from(agentOutputs)
            .where(eq(agentOutputs.runId, runId));
          return calls.map((c) => ({
            id: c.id,
            attempt: c.attempt,
            status: c.status as "RUNNING" | "SUCCEEDED" | "FAILED",
            reservedNanousd: c.reservedNanousd,
            costNanousd: c.costNanousd,
            retryable: c.retryable,
            output:
              outputs.find((o) => o.invocationId === c.id)?.analysis ?? null,
          }));
        },
        async reserve(input) {
          return db.transaction(async (tx) => {
            await tx.execute(sql`set local statement_timeout = '30s'`);
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext('agent-monthly-budget'))`,
            );
            const run = (
              await tx
                .select()
                .from(agentRuns)
                .where(eq(agentRuns.id, runId))
                .for("update")
            )[0];
            if (
              !run ||
              run.status !== "RUNNING" ||
              !run.policySnapshot ||
              !run.budgetMonth
            )
              throw new AgentError("AGENT_RUN_NOT_RUNNING");
            const policy = policySchema.parse(run.policySnapshot);
            const agent = agentTypeSchema.parse(input.agent);
            const route = getAgentRoute(policy, agent);
            if (
              input.provider !== route.provider ||
              input.model !== route.model ||
              input.promptVersion !== run.promptVersion
            )
              throw new AgentError("AGENT_ROUTE_MISMATCH");
            const evidence = (
              await tx
                .select()
                .from(agentEvidence)
                .where(eq(agentEvidence.runId, runId))
            )[0]!;
            const plan = selectSpecialists(
              evidenceSchema.parse(evidence.bundle),
              policy.maxSpecialists,
              policy.executionMode,
            );
            if (agent !== "SUPERVISOR" && !plan.includes(agent))
              throw new AgentError("AGENT_OUTSIDE_SUPERVISOR_PLAN");
            if (agent === "SUPERVISOR") {
              const outputs = await tx
                .select()
                .from(agentOutputs)
                .where(eq(agentOutputs.runId, runId));
              if (
                plan.some(
                  (step) =>
                    !outputs.some(
                      (o) =>
                        o.analysis.agent === step &&
                        o.analysis.assessment === "SUPPORTED",
                    ),
                )
              )
                throw new AgentError("SPECIALIST_OUTPUTS_REQUIRED");
            }
            if (
              !Number.isInteger(input.attempt) ||
              input.attempt < 0 ||
              input.attempt > policy.retryLimit
            )
              throw new AgentError("AGENT_ATTEMPT_LIMIT");
            const reserved = BigInt(input.reservedNanousd);
            if (reserved < 0n) throw new AgentError("INVALID_COST_RESERVATION");
            const month = new Date().toISOString().slice(0, 7);
            await tx
              .insert(agentBudgetMonths)
              .values({
                month,
                limitNanousd: String(policy.monthlyBudgetNanousd),
              })
              .onConflictDoNothing();
            const monthly = (
              await tx
                .select()
                .from(agentBudgetMonths)
                .where(eq(agentBudgetMonths.month, month))
                .for("update")
            )[0]!;
            if (
              run.invocationCount >= policy.maxInvocations ||
              BigInt(run.bookedNanousd) + reserved >
                BigInt(policy.runBudgetNanousd) ||
              BigInt(monthly.bookedNanousd) + reserved >
                (BigInt(monthly.limitNanousd) <
                BigInt(policy.monthlyBudgetNanousd)
                  ? BigInt(monthly.limitNanousd)
                  : BigInt(policy.monthlyBudgetNanousd))
            )
              throw new AgentError("AGENT_BUDGET_EXCEEDED");
            const call = (
              await tx
                .insert(agentInvocations)
                .values({
                  runId,
                  agentType: agent,
                  budgetMonth: month,
                  attempt: input.attempt,
                  provider: route.provider,
                  model: route.model,
                  promptVersion: run.promptVersion,
                  schemaVersion: run.schemaVersion,
                  inputHash: input.inputHash,
                  reservedNanousd: reserved.toString(),
                })
                .returning()
            )[0]!;
            await tx
              .update(agentRuns)
              .set({
                bookedNanousd: (
                  BigInt(run.bookedNanousd) + reserved
                ).toString(),
                invocationCount: run.invocationCount + 1,
              })
              .where(eq(agentRuns.id, runId));
            await tx
              .update(agentBudgetMonths)
              .set({
                limitNanousd: (BigInt(monthly.limitNanousd) <
                BigInt(policy.monthlyBudgetNanousd)
                  ? BigInt(monthly.limitNanousd)
                  : BigInt(policy.monthlyBudgetNanousd)
                ).toString(),
                bookedNanousd: (
                  BigInt(monthly.bookedNanousd) + reserved
                ).toString(),
                updatedAt: new Date(),
              })
              .where(eq(agentBudgetMonths.month, month));
            return call.id;
          });
        },
        async settle(id, input) {
          await db.transaction(async (tx) => {
            await tx.execute(sql`set local statement_timeout = '30s'`);
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext('agent-monthly-budget'))`,
            );
            const call = (
              await tx
                .select()
                .from(agentInvocations)
                .where(
                  and(
                    eq(agentInvocations.id, id),
                    eq(agentInvocations.runId, runId),
                  ),
                )
                .for("update")
            )[0];
            if (!call) throw new AgentError("AGENT_CALL_UNAVAILABLE");
            if (call.status !== "RUNNING") return;
            const run = (
              await tx
                .select()
                .from(agentRuns)
                .where(eq(agentRuns.id, runId))
                .for("update")
            )[0]!;
            const monthly = (
              await tx
                .select()
                .from(agentBudgetMonths)
                .where(eq(agentBudgetMonths.month, call.budgetMonth))
                .for("update")
            )[0]!;
            const cost = BigInt(input.costNanousd);
            if (cost < 0n) throw new AgentError("INVALID_AGENT_COST");
            const delta = cost - BigInt(call.reservedNanousd);
            if ((input.errorCode === null) !== (input.output !== null))
              throw new AgentError("INVALID_AGENT_SETTLEMENT_CONTRACT");
            if (input.output) {
              const analysis = analysisSchema.parse(input.output);
              const evidence = (
                await tx
                  .select()
                  .from(agentEvidence)
                  .where(eq(agentEvidence.runId, runId))
              )[0]!;
              // Validate at the persistence boundary too: never trust a custom worker's unchecked output.
              const checked = validatePersistedAnalysis(
                analysis,
                agentTypeSchema.parse(call.agentType),
                evidenceSchema.parse(evidence.bundle),
                (
                  await tx
                    .select()
                    .from(agentOutputs)
                    .where(eq(agentOutputs.runId, runId))
                )
                  .map((o) => o.analysis)
                  .filter((a) => a.agent !== "SUPERVISOR"),
              );
              await tx.insert(agentOutputs).values({
                runId,
                invocationId: id,
                schemaVersion: run.schemaVersion,
                analysis: checked,
              });
            }
            await tx
              .update(agentInvocations)
              .set({
                status: input.errorCode === null ? "SUCCEEDED" : "FAILED",
                costNanousd: cost.toString(),
                costBasis: input.costBasis,
                inputTokens: input.result?.inputTokens ?? null,
                outputTokens: input.result?.outputTokens ?? null,
                providerRequestId: input.result?.providerRequestId ?? null,
                httpStatus: input.httpStatus,
                errorCode: input.errorCode,
                retryable: input.retryable,
                durationMs: input.durationMs,
                finishedAt: new Date(),
              })
              .where(eq(agentInvocations.id, id));
            await tx
              .update(agentRuns)
              .set({
                bookedNanousd: (BigInt(run.bookedNanousd) + delta).toString(),
              })
              .where(eq(agentRuns.id, runId));
            await tx
              .update(agentBudgetMonths)
              .set({
                bookedNanousd: (
                  BigInt(monthly.bookedNanousd) + delta
                ).toString(),
                updatedAt: new Date(),
              })
              .where(eq(agentBudgetMonths.month, call.budgetMonth));
          });
        },
      };
    },
    async complete(id, rawDraft) {
      await db.transaction(async (tx) => {
        const run = (
          await tx
            .select()
            .from(agentRuns)
            .where(eq(agentRuns.id, id))
            .for("update")
        )[0];
        if (!run || run.status === "SUCCEEDED") return;
        const pending = (
          await tx
            .select()
            .from(agentInvocations)
            .where(
              and(
                eq(agentInvocations.runId, id),
                eq(agentInvocations.status, "RUNNING"),
              ),
            )
            .limit(1)
        )[0];
        if (pending) throw new AgentError("AGENT_CALLS_STILL_RUNNING");
        if (rawDraft) {
          const draft = draftSchema.parse(rawDraft);
          if (draft.analysis.assessment !== "SUPPORTED")
            throw new AgentError("DRAFT_REQUIRES_SUPPORTED_ANALYSIS");
          const call = (
            await tx
              .select()
              .from(agentInvocations)
              .where(
                and(
                  eq(agentInvocations.runId, id),
                  eq(agentInvocations.agentType, "SUPERVISOR"),
                  eq(agentInvocations.status, "SUCCEEDED"),
                ),
              )
              .limit(1)
          )[0];
          if (!call) throw new AgentError("VALIDATED_SUPERVISOR_REQUIRED");
          const output = (
            await tx
              .select()
              .from(agentOutputs)
              .where(eq(agentOutputs.invocationId, call.id))
          )[0]!;
          if (
            !isDeepStrictEqual(
              analysisSchema.parse(output.analysis),
              draft.analysis,
            )
          )
            throw new AgentError("DRAFT_DOES_NOT_MATCH_VALIDATED_OUTPUT");
          await tx
            .update(agentOutputs)
            .set({ draft })
            .where(eq(agentOutputs.id, output.id));
        }
        await tx
          .update(agentRuns)
          .set({
            status: "SUCCEEDED",
            outcome: rawDraft ? "DRAFT_CREATED" : "INSUFFICIENT_EVIDENCE",
            finishedAt: new Date(),
            errorCode: null,
          })
          .where(eq(agentRuns.id, id));
      });
    },
    async fail(id, code) {
      await db
        .update(agentRuns)
        .set({ status: "FAILED", errorCode: code, finishedAt: new Date() })
        .where(
          and(eq(agentRuns.id, id), sql`${agentRuns.status} <> 'SUCCEEDED'`),
        );
    },
  };
}
import { validateAnalysis } from "@roco/agents";
function validatePersistedAnalysis(
  output: (typeof agentOutputs.$inferInsert)["analysis"],
  agent: Parameters<typeof validateAnalysis>[1],
  evidence: EvidenceBundle,
  specialists: Analysis[],
) {
  // Already-normalized confidence is checked against the source ceiling without applying the quality penalty twice.
  const checked = validateAnalysis(
    output,
    agent,
    { ...evidence, quality: 1 },
    agent === "SUPERVISOR" ? specialists : [],
  );
  if (output.confidence > evidence.sourceConfidence * evidence.quality)
    throw new AgentError("CONFIDENCE_EXCEEDS_EVIDENCE");
  return checked;
}
