import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { draftSchema } from "@roco/agents";
import { isInternalUrl } from "@roco/seo-core";
import {
  WorkflowError,
  requireRole,
  approvalRole,
  nextRecommendationState,
  validateProposal,
  validateActualAfter,
  proposalRisk,
  windowsForChange,
  eligibleAt,
  validateTimestamp,
  createRecommendationSchema,
  versionSchema,
  transitionSchema,
  implementSchema,
  revertSchema,
  correctionSchema,
  baselineRefreshSchema,
  type Principal,
  type Proposal,
  listSchema,
} from "@roco/workflow";
import { captureMeasurement } from "./measurement-source.js";
import * as s from "./schema.js";
export type WorkflowDatabase = NodePgDatabase<typeof s>;
type Tx = Parameters<Parameters<WorkflowDatabase["transaction"]>[0]>[0];
export async function assertWorkflowActor(
  tx: Pick<WorkflowDatabase, "select">,
  actorId: string,
  human = true,
): Promise<void> {
  const actor = (
    await tx
      .select()
      .from(s.actors)
      .where(and(eq(s.actors.id, actorId), sql`${s.actors.disabledAt} is null`))
  )[0];
  if (!actor) throw new WorkflowError("ACTIVE_ACTOR_REQUIRED");
  if (human && actor.type !== "HUMAN")
    throw new WorkflowError("HUMAN_ACTOR_REQUIRED");
}
export async function auditWorkflow(
  tx: Pick<WorkflowDatabase, "insert">,
  p: Principal,
  action: string,
  subjectType: string,
  subjectId: string,
  now: Date,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(s.auditEvents).values({
    actorId: p.actorId,
    action,
    subjectType,
    subjectId,
    correlationId: p.correlationId,
    createdAt: now,
    metadata,
  });
}
export async function insertBaseline(
  tx: Tx,
  change: typeof s.changeLedgerEntries.$inferSelect,
  proposal: Proposal,
  p: Principal,
  now: Date,
  reason: string,
  key: string,
): Promise<typeof s.changeBaselines.$inferSelect> {
  const prior = (
    await tx
      .select()
      .from(s.changeBaselines)
      .where(
        and(
          eq(s.changeBaselines.changeId, change.id),
          eq(s.changeBaselines.idempotencyKey, key),
        ),
      )
  )[0];
  if (prior) {
    if (prior.actorId !== p.actorId || prior.reason !== reason)
      throw new WorkflowError("WORKFLOW_IDEMPOTENCY_CONFLICT");
    return prior;
  }
  const window = windowsForChange(change.implementedAt, proposal.rule);
  const sample = await captureMeasurement(tx, {
    siteId: change.siteId,
    pageId: change.pageId,
    ...window,
    rule: proposal.rule,
    now,
    asOf: change.implementedAt,
  });
  const last = (
    await tx
      .select()
      .from(s.changeBaselines)
      .where(eq(s.changeBaselines.changeId, change.id))
      .orderBy(desc(s.changeBaselines.number))
      .limit(1)
  )[0];
  const baseline = (
    await tx
      .insert(s.changeBaselines)
      .values({
        changeId: change.id,
        number: (last?.number ?? 0) + 1,
        actorId: p.actorId,
        sample,
        reason,
        idempotencyKey: key,
        createdAt: now,
      })
      .returning()
  )[0]!;
  await auditWorkflow(
    tx,
    p,
    "workflow.baseline.captured",
    "change",
    change.id,
    now,
    { baselineId: baseline.id, baselineVersion: baseline.number, window },
  );
  return baseline;
}
async function checkProposalScope(tx: Tx, siteId: string, proposal: Proposal) {
  validateProposal(proposal);
  const page = (
    await tx
      .select()
      .from(s.pages)
      .where(and(eq(s.pages.id, proposal.pageId), eq(s.pages.siteId, siteId)))
  )[0];
  if (!page) throw new WorkflowError("PAGE_NOT_IN_SITE");
  const site = (
    await tx.select().from(s.sites).where(eq(s.sites.id, siteId))
  )[0]!;
  const hosts = await tx
    .select({
      host: s.siteHosts.host,
      includeSubdomains: s.siteHosts.includeSubdomains,
    })
    .from(s.siteHosts)
    .where(eq(s.siteHosts.siteId, siteId));
  for (const value of [proposal.before, proposal.after]) {
    for (const url of [value.url, value.canonicalUrl, value.redirectTarget])
      if (
        url &&
        !isInternalUrl(url, {
          canonicalOrigin: site.canonicalOrigin,
          allowedHosts: hosts,
        })
      )
        throw new WorkflowError("PROPOSAL_URL_OUTSIDE_APPROVED_SCOPE");
    for (const link of value.internalLinks ?? []) {
      const valid = await tx
        .select({ id: s.pages.id })
        .from(s.pages)
        .where(
          and(
            eq(s.pages.siteId, siteId),
            inArray(s.pages.id, [link.sourcePageId, link.targetPageId]),
          ),
        );
      if (
        !valid.some((p) => p.id === link.sourcePageId) ||
        !valid.some((p) => p.id === link.targetPageId)
      )
        throw new WorkflowError("LINK_PAGE_OUTSIDE_SITE");
    }
  }
}
async function currentRecommendation(tx: Tx, siteId: string, id: string) {
  const rec = (
    await tx
      .select()
      .from(s.recommendations)
      .where(
        and(eq(s.recommendations.id, id), eq(s.recommendations.siteId, siteId)),
      )
      .for("update")
  )[0];
  if (!rec || !rec.currentVersionId)
    throw new WorkflowError("RECOMMENDATION_NOT_FOUND");
  const version = (
    await tx
      .select()
      .from(s.recommendationVersions)
      .where(
        and(
          eq(s.recommendationVersions.id, rec.currentVersionId),
          eq(s.recommendationVersions.recommendationId, id),
        ),
      )
  )[0];
  if (!version) throw new WorkflowError("RECOMMENDATION_VERSION_UNAVAILABLE");
  return { rec, version };
}
export function createWorkflowRepository(
  db: WorkflowDatabase,
  clock: () => Date = () => new Date(),
) {
  return {
    async create(siteId: string, raw: unknown, p: Principal) {
      requireRole(p, "OPERATOR");
      const input = createRecommendationSchema.parse(raw);
      const now = clock();
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`workflow-site:${siteId}`}))`,
        );
        await assertWorkflowActor(tx, p.actorId);
        const existing = (
          await tx
            .select()
            .from(s.recommendations)
            .where(
              and(
                eq(s.recommendations.siteId, siteId),
                eq(s.recommendations.idempotencyKey, input.idempotencyKey),
              ),
            )
        )[0];
        if (existing) {
          const original = (
            await tx
              .select()
              .from(s.recommendationVersions)
              .where(
                and(
                  eq(s.recommendationVersions.recommendationId, existing.id),
                  eq(s.recommendationVersions.number, 1),
                ),
              )
          )[0]!;
          if (
            existing.agentOutputId !== input.agentOutputId ||
            existing.actionIndex !== input.actionIndex ||
            existing.mode !== input.mode ||
            !isDeepStrictEqual(original.proposal, input.proposal)
          )
            throw new WorkflowError("WORKFLOW_IDEMPOTENCY_CONFLICT");
          return existing;
        }
        const source = (
          await tx
            .select({ output: s.agentOutputs, run: s.agentRuns })
            .from(s.agentOutputs)
            .innerJoin(s.agentRuns, eq(s.agentRuns.id, s.agentOutputs.runId))
            .where(
              and(
                eq(s.agentOutputs.id, input.agentOutputId),
                eq(s.agentRuns.siteId, siteId),
                eq(s.agentRuns.status, "SUCCEEDED"),
              ),
            )
            .limit(1)
        )[0];
        if (!source || !source.output.draft)
          throw new WorkflowError("VALIDATED_DRAFT_REQUIRED");
        const draft = draftSchema.parse(source.output.draft);
        const action = draft.analysis.actions[input.actionIndex];
        if (
          !action ||
          action.type !== input.proposal.changeType ||
          action.targetPageId !== input.proposal.pageId
        )
          throw new WorkflowError("PROPOSAL_DOES_NOT_MATCH_DRAFT_TARGET");
        await checkProposalScope(tx, siteId, input.proposal);
        const duplicate = (
          await tx
            .select()
            .from(s.recommendations)
            .where(
              and(
                eq(s.recommendations.agentOutputId, input.agentOutputId),
                eq(s.recommendations.actionIndex, input.actionIndex),
                eq(s.recommendations.mode, input.mode),
              ),
            )
        )[0];
        if (duplicate)
          throw new WorkflowError(
            "RECOMMENDATION_ALREADY_EXISTS_USE_VERSIONING",
          );
        const rec = (
          await tx
            .insert(s.recommendations)
            .values({
              siteId,
              opportunityId: source.run.opportunityId,
              agentOutputId: input.agentOutputId,
              actionIndex: input.actionIndex,
              pageId: input.proposal.pageId,
              changeType: input.proposal.changeType,
              mode: input.mode,
              idempotencyKey: input.idempotencyKey,
              createdBy: p.actorId,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
        )[0]!;
        const version = (
          await tx
            .insert(s.recommendationVersions)
            .values({
              recommendationId: rec.id,
              number: 1,
              proposal: input.proposal,
              risk: proposalRisk(draft.analysis, input.proposal.changeType),
              confidence: draft.analysis.confidence,
              createdBy: p.actorId,
              createdAt: now,
            })
            .returning()
        )[0]!;
        const updated = (
          await tx
            .update(s.recommendations)
            .set({ currentVersionId: version.id })
            .where(eq(s.recommendations.id, rec.id))
            .returning()
        )[0]!;
        await tx.insert(s.recommendationEvents).values({
          recommendationId: rec.id,
          versionId: version.id,
          actorId: p.actorId,
          action: "GENERATED",
          toState: "DRAFT",
          reason: input.proposal.reason,
          createdAt: now,
        });
        await auditWorkflow(
          tx,
          p,
          "workflow.recommendation.generated",
          "recommendation",
          rec.id,
          now,
          {
            versionId: version.id,
            sourceAgentOutputId: source.output.id,
            mode: input.mode,
          },
        );
        return updated;
      });
    },
    async revise(siteId: string, id: string, raw: unknown, p: Principal) {
      requireRole(p, "OPERATOR");
      const input = versionSchema.parse(raw);
      const now = clock();
      return db.transaction(async (tx) => {
        await assertWorkflowActor(tx, p.actorId);
        const { rec, version } = await currentRecommendation(tx, siteId, id);
        if (
          rec.currentVersionId !== input.expectedVersionId ||
          !["DRAFT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"].includes(
            rec.state,
          )
        )
          throw new WorkflowError("RECOMMENDATION_REVISION_CONFLICT");
        if (
          input.proposal.pageId !== rec.pageId ||
          input.proposal.changeType !== rec.changeType
        )
          throw new WorkflowError("REVISION_CANNOT_RETARGET_CHANGE");
        await checkProposalScope(tx, siteId, input.proposal);
        if (rec.state === "APPROVED")
          await tx.insert(s.approvalDecisions).values({
            recommendationId: id,
            versionId: version.id,
            actorId: p.actorId,
            decision: "SUPERSEDED",
            reviewerRoles: p.roles,
            reason: "A new proposal version invalidates earlier approval.",
            createdAt: now,
          });
        const next = (
          await tx
            .insert(s.recommendationVersions)
            .values({
              recommendationId: id,
              number: version.number + 1,
              proposal: input.proposal,
              risk: version.risk,
              confidence: version.confidence,
              createdBy: p.actorId,
              createdAt: now,
            })
            .returning()
        )[0]!;
        await tx
          .update(s.recommendations)
          .set({ currentVersionId: next.id, state: "DRAFT", updatedAt: now })
          .where(eq(s.recommendations.id, id));
        await tx.insert(s.recommendationEvents).values({
          recommendationId: id,
          versionId: next.id,
          actorId: p.actorId,
          action: "REVISED",
          fromState: rec.state,
          toState: "DRAFT",
          reason: input.proposal.reason,
          createdAt: now,
        });
        await auditWorkflow(
          tx,
          p,
          "workflow.recommendation.revised",
          "recommendation",
          id,
          now,
          { previousVersionId: version.id, versionId: next.id },
        );
        return next;
      });
    },
    async transition(siteId: string, id: string, raw: unknown, p: Principal) {
      const input = transitionSchema.parse(raw);
      const now = clock();
      return db.transaction(async (tx) => {
        await assertWorkflowActor(tx, p.actorId);
        const { rec, version } = await currentRecommendation(tx, siteId, id);
        requireRole(
          p,
          input.action === "SUBMIT" || input.action === "CANCEL"
            ? "OPERATOR"
            : approvalRole(version.risk),
        );
        if (
          rec.currentVersionId !== input.expectedVersionId ||
          rec.state !== input.expectedState
        )
          throw new WorkflowError("STALE_REVIEW_CONTEXT");
        const state = nextRecommendationState(rec.state, input.action);
        if (["APPROVE", "REJECT", "REQUEST_CHANGES"].includes(input.action))
          await tx.insert(s.approvalDecisions).values({
            recommendationId: id,
            versionId: version.id,
            actorId: p.actorId,
            decision: state,
            reviewerRoles: p.roles,
            reason: input.reason,
            createdAt: now,
          });
        await tx
          .update(s.recommendations)
          .set({ state, updatedAt: now })
          .where(eq(s.recommendations.id, id));
        await tx.insert(s.recommendationEvents).values({
          recommendationId: id,
          versionId: version.id,
          actorId: p.actorId,
          action: input.action,
          fromState: rec.state,
          toState: state,
          reason: input.reason,
          createdAt: now,
        });
        await auditWorkflow(
          tx,
          p,
          `workflow.recommendation.${input.action.toLowerCase()}`,
          "recommendation",
          id,
          now,
          { versionId: version.id, fromState: rec.state, toState: state },
        );
        return { id, state, versionId: version.id };
      });
    },
    async implement(siteId: string, id: string, raw: unknown, p: Principal) {
      requireRole(p, "OPERATOR");
      const input = implementSchema.parse(raw);
      const now = clock();
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`workflow-site:${siteId}`}))`,
        );
        await assertWorkflowActor(tx, p.actorId);
        const { rec, version } = await currentRecommendation(tx, siteId, id);
        const old = (
          await tx
            .select()
            .from(s.changeLedgerEntries)
            .where(
              and(
                eq(s.changeLedgerEntries.siteId, siteId),
                eq(s.changeLedgerEntries.idempotencyKey, input.idempotencyKey),
              ),
            )
        )[0];
        if (old) {
          if (
            old.recommendationId !== id ||
            old.versionId !== input.versionId ||
            old.implementedAt.toISOString() !== input.implementedAt ||
            !isDeepStrictEqual(old.afterValues, input.actualAfter) ||
            !isDeepStrictEqual(old.beforeValues, input.actualBefore) ||
            old.notes !== input.notes ||
            old.externalReference !== input.externalReference ||
            old.implementedBy !== p.actorId
          )
            throw new WorkflowError("WORKFLOW_IDEMPOTENCY_CONFLICT");
          return old;
        }
        if (
          rec.state !== "APPROVED" ||
          rec.currentVersionId !== input.versionId
        )
          throw new WorkflowError("APPROVED_CURRENT_VERSION_REQUIRED");
        const approval = (
          await tx
            .select()
            .from(s.approvalDecisions)
            .where(
              and(
                eq(s.approvalDecisions.versionId, version.id),
                eq(s.approvalDecisions.decision, "APPROVED"),
              ),
            )
        )[0];
        if (!approval) throw new WorkflowError("HUMAN_APPROVAL_REQUIRED");
        validateActualAfter(version.proposal.after, input.actualAfter);
        validateActualAfter(version.proposal.before, input.actualBefore);
        const implementedAt = new Date(input.implementedAt);
        validateTimestamp(implementedAt, now, approval.createdAt);
        const change = (
          await tx
            .insert(s.changeLedgerEntries)
            .values({
              siteId,
              recommendationId: id,
              versionId: version.id,
              approvalId: approval.id,
              pageId: rec.pageId,
              mode: rec.mode,
              beforeValues: input.actualBefore,
              afterValues: input.actualAfter,
              implementedBy: p.actorId,
              implementedAt,
              notes: input.notes,
              externalReference: input.externalReference,
              idempotencyKey: input.idempotencyKey,
              recordedAt: now,
            })
            .returning()
        )[0]!;
        const baseline = await insertBaseline(
          tx,
          change,
          version.proposal,
          p,
          now,
          "Initial baseline at declared implementation",
          "initial",
        );
        for (const horizon of [30, 60, 90] as const) {
          const window = windowsForChange(
            implementedAt,
            version.proposal.rule,
            horizon,
          );
          const ready = eligibleAt(
            implementedAt,
            horizon,
            version.proposal.rule,
          );
          await tx.insert(s.measurementPlans).values({
            changeId: change.id,
            initialBaselineId: baseline.id,
            horizon,
            ...window,
            dueAt: new Date(implementedAt.getTime() + horizon * 86400000),
            readyAt: ready,
            nextCheckAt: ready,
            createdAt: now,
          });
        }
        await tx
          .update(s.recommendations)
          .set({ state: "IMPLEMENTED", updatedAt: now })
          .where(eq(s.recommendations.id, id));
        await tx.insert(s.recommendationEvents).values({
          recommendationId: id,
          versionId: version.id,
          actorId: p.actorId,
          action: "IMPLEMENTATION_RECORDED",
          fromState: "APPROVED",
          toState: "IMPLEMENTED",
          reason: input.notes,
          createdAt: now,
        });
        await auditWorkflow(
          tx,
          p,
          "workflow.implementation.recorded",
          "change",
          change.id,
          now,
          { versionId: version.id, mode: rec.mode, baselineId: baseline.id },
        );
        return change;
      });
    },
    async event(
      siteId: string,
      id: string,
      kind: "REVERT" | "CORRECTION",
      raw: unknown,
      p: Principal,
    ) {
      requireRole(p, "OPERATOR");
      const now = clock();
      const input =
        kind === "REVERT"
          ? revertSchema.parse(raw)
          : correctionSchema.parse(raw);
      return db.transaction(async (tx) => {
        await assertWorkflowActor(tx, p.actorId);
        const change = (
          await tx
            .select()
            .from(s.changeLedgerEntries)
            .where(
              and(
                eq(s.changeLedgerEntries.siteId, siteId),
                eq(s.changeLedgerEntries.id, id),
              ),
            )
            .for("update")
        )[0];
        if (!change) throw new WorkflowError("CHANGE_NOT_FOUND");
        const old = (
          await tx
            .select()
            .from(s.changeEvents)
            .where(
              and(
                eq(s.changeEvents.changeId, id),
                eq(s.changeEvents.idempotencyKey, input.idempotencyKey),
              ),
            )
        )[0];
        if (old) {
          if (
            old.type !== kind ||
            old.actorId !== p.actorId ||
            old.reason !== input.reason ||
            ("revertedAt" in input
              ? old.occurredAt.toISOString() !== input.revertedAt ||
                !isDeepStrictEqual(old.values, input.values) ||
                old.externalReference !== input.externalReference
              : old.note !== input.note)
          )
            throw new WorkflowError("WORKFLOW_IDEMPOTENCY_CONFLICT");
          return old;
        }
        let values = null,
          occurredAt = now,
          externalReference = null,
          note = null;
        if ("revertedAt" in input) {
          occurredAt = new Date(input.revertedAt);
          validateTimestamp(occurredAt, now, change.implementedAt);
          const version = (
            await tx
              .select()
              .from(s.recommendationVersions)
              .where(eq(s.recommendationVersions.id, change.versionId))
          )[0]!;
          validateProposal({
            ...version.proposal,
            before: change.afterValues,
            after: input.values,
          });
          values = input.values;
          externalReference = input.externalReference;
        } else note = input.note;
        const event = (
          await tx
            .insert(s.changeEvents)
            .values({
              changeId: id,
              actorId: p.actorId,
              type: kind,
              values,
              reason: input.reason,
              note,
              externalReference,
              occurredAt,
              recordedAt: now,
              idempotencyKey: input.idempotencyKey,
            })
            .returning()
        )[0]!;
        await auditWorkflow(
          tx,
          p,
          `workflow.change.${kind.toLowerCase()}`,
          "change",
          id,
          now,
          { eventId: event.id },
        );
        return event;
      });
    },
    async refreshBaseline(
      siteId: string,
      id: string,
      raw: unknown,
      p: Principal,
    ) {
      requireRole(p, "OPERATOR");
      const input = baselineRefreshSchema.parse(raw),
        now = clock();
      return db.transaction(async (tx) => {
        await assertWorkflowActor(tx, p.actorId);
        const change = (
          await tx
            .select()
            .from(s.changeLedgerEntries)
            .where(
              and(
                eq(s.changeLedgerEntries.id, id),
                eq(s.changeLedgerEntries.siteId, siteId),
              ),
            )
            .for("update")
        )[0];
        if (!change) throw new WorkflowError("CHANGE_NOT_FOUND");
        const version = (
          await tx
            .select()
            .from(s.recommendationVersions)
            .where(eq(s.recommendationVersions.id, change.versionId))
        )[0]!;
        return insertBaseline(
          tx,
          change,
          version.proposal,
          p,
          now,
          input.reason,
          input.idempotencyKey,
        );
      });
    },
    async list(siteId: string, raw: unknown, p: Principal) {
      requireRole(p, "READ");
      await assertWorkflowActor(db, p.actorId, false);
      const filter = listSchema.parse(raw);
      const conditions = [eq(s.recommendations.siteId, siteId)];
      if (filter.state)
        conditions.push(eq(s.recommendations.state, filter.state));
      if (filter.pageId)
        conditions.push(eq(s.recommendations.pageId, filter.pageId));
      if (filter.risk)
        conditions.push(eq(s.recommendationVersions.risk, filter.risk));
      const rows = await db
        .select({
          recommendation: s.recommendations,
          version: s.recommendationVersions,
        })
        .from(s.recommendations)
        .innerJoin(
          s.recommendationVersions,
          eq(s.recommendationVersions.id, s.recommendations.currentVersionId),
        )
        .where(and(...conditions))
        .orderBy(desc(s.recommendations.updatedAt), asc(s.recommendations.id))
        .limit(filter.limit + 1)
        .offset(filter.offset);
      return {
        items: rows.slice(0, filter.limit),
        hasMore: rows.length > filter.limit,
      };
    },
    async detail(siteId: string, id: string, p: Principal) {
      requireRole(p, "READ");
      await assertWorkflowActor(db, p.actorId, false);
      const rec = (
        await db
          .select()
          .from(s.recommendations)
          .where(
            and(
              eq(s.recommendations.id, id),
              eq(s.recommendations.siteId, siteId),
            ),
          )
      )[0];
      if (!rec) return null;
      const versions = await db
        .select()
        .from(s.recommendationVersions)
        .where(eq(s.recommendationVersions.recommendationId, id))
        .orderBy(desc(s.recommendationVersions.number))
        .limit(100);
      const decisions = await db
        .select()
        .from(s.approvalDecisions)
        .where(eq(s.approvalDecisions.recommendationId, id))
        .orderBy(desc(s.approvalDecisions.createdAt))
        .limit(100);
      const events = await db
        .select()
        .from(s.recommendationEvents)
        .where(eq(s.recommendationEvents.recommendationId, id))
        .orderBy(desc(s.recommendationEvents.createdAt))
        .limit(100);
      return { ...rec, versions, decisions, events, historyLimit: 100 };
    },
    async ledger(siteId: string, id: string, p: Principal) {
      requireRole(p, "READ");
      await assertWorkflowActor(db, p.actorId, false);
      const change = (
        await db
          .select()
          .from(s.changeLedgerEntries)
          .where(
            and(
              eq(s.changeLedgerEntries.id, id),
              eq(s.changeLedgerEntries.siteId, siteId),
            ),
          )
      )[0];
      if (!change) return null;
      const version = (
        await db
          .select()
          .from(s.recommendationVersions)
          .where(eq(s.recommendationVersions.id, change.versionId))
      )[0];
      const approval = (
        await db
          .select()
          .from(s.approvalDecisions)
          .where(eq(s.approvalDecisions.id, change.approvalId))
      )[0];
      const recommendation = (
        await db
          .select()
          .from(s.recommendations)
          .where(eq(s.recommendations.id, change.recommendationId))
      )[0];
      const events = await db
        .select()
        .from(s.changeEvents)
        .where(eq(s.changeEvents.changeId, id))
        .orderBy(desc(s.changeEvents.recordedAt))
        .limit(100);
      const baselines = await db
        .select()
        .from(s.changeBaselines)
        .where(eq(s.changeBaselines.changeId, id))
        .orderBy(desc(s.changeBaselines.number))
        .limit(100);
      const plans = await db
        .select()
        .from(s.measurementPlans)
        .where(eq(s.measurementPlans.changeId, id));
      return {
        ...change,
        version,
        approval,
        recommendation,
        events,
        baselines,
        plans,
      };
    },
  };
}
export type WorkflowRepository = ReturnType<typeof createWorkflowRepository>;
