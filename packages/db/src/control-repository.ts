import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  controlFilterSchema,
  controlListSchema,
  type ControlSection,
  type ControlFilter,
} from "@roco/shared/control";
import {
  defaultRule,
  requireRole,
  nextRecommendationState,
  approvalRole,
  WorkflowError,
  type Principal,
  type MeasurementSample,
} from "@roco/workflow";
import { createWorkflowRepository } from "./workflow-repository.js";
import { createMeasurementRepository } from "./measurement-repository.js";
import { createOpportunityRepository } from "./opportunity-repository.js";
import * as s from "./schema.js";

function summarizedSample(sample: MeasurementSample) {
  const group = (value: MeasurementSample["gsc"]) => ({
    ...value,
    sourceIds: value.sourceIds.slice(0, 100),
    sourceCount: value.sourceIds.length,
    sourceIdsTruncated: value.sourceIds.length > 100,
  });
  return {
    ...sample,
    gsc: group(sample.gsc),
    ga4: group(sample.ga4),
    psi: group(sample.psi),
    crawl: group(sample.crawl),
  };
}

/** Read models only. All user values stay bound SQL parameters. */
export function createControlRepository(db: NodePgDatabase<typeof s>) {
  const workflow = createWorkflowRepository(db),
    measurement = createMeasurementRepository(db),
    opportunities = createOpportunityRepository(db);
  async function identity(p: Principal) {
    requireRole(p, "READ");
    const actor = (
      await db
        .select({ actorId: s.actors.id, displayName: s.actors.displayName })
        .from(s.actors)
        .where(
          and(
            eq(s.actors.id, p.actorId),
            eq(s.actors.type, "HUMAN"),
            isNull(s.actors.disabledAt),
          ),
        )
    )[0];
    if (!actor) throw new WorkflowError("HUMAN_ACTOR_REQUIRED");
    return { ...actor, roles: p.roles };
  }
  async function rows(query: SQL) {
    return db.transaction(
      async (tx) => {
        await tx.execute(sql`set local statement_timeout='5s'`);
        return (await tx.execute(query)).rows;
      },
      { accessMode: "read only" },
    );
  }
  async function list(
    query: SQL,
    f: ControlFilter,
    notes: string[] = [],
    summary: Record<string, unknown> = {},
  ) {
    const items = await rows(query);
    return controlListSchema.parse({
      items: items.slice(0, f.limit),
      hasMore: items.length > f.limit,
      limit: f.limit,
      offset: f.offset,
      notes,
      summary,
    });
  }
  async function freshness(siteId: string) {
    // Each configured dataset has independent success/failure provenance.
    return rows(sql`with sources as (
      select 'CRAWL' as source,id,status::text,created_at,finished_at,error_code from crawl_runs where site_id=${siteId}
      union all select provider::text || case when provider='GSC' then coalesce(' / ' || dimension_set,'') else '' end,id,status::text,created_at,finished_at,error_code from integration_sync_runs where site_id=${siteId}
      union all select 'OPPORTUNITIES',id,status::text,created_at,finished_at,error_code from opportunity_runs where site_id=${siteId}
      union all select 'AGENTS',id,status::text,created_at,finished_at,error_code from agent_runs where site_id=${siteId}
    ), names as (select unnest(array['CRAWL','GSC / PAGE','GSC / QUERY','GSC / PAGE_QUERY','GA4','PAGESPEED','OPPORTUNITIES','AGENTS']) as source)
    select n.source as id,n.source as label,coalesce(latest.status,'NO_DATA') as status,
      latest.finished_at::text as at,jsonb_build_object('latestRunId',latest.id,'errorCode',latest.error_code,
      'latestSuccess',ok.finished_at,'latestSuccessId',ok.id,'latestFailure',failed.finished_at,
      'freshness',case when ok.finished_at is null then 'NO_SUCCESSFUL_DATA' when ok.finished_at < now()-interval '7 days' then 'OLDER_THAN_7_DAYS' else 'WITHIN_7_DAYS' end) as data
    from names n left join lateral(select * from sources where source=n.source order by created_at desc,id desc limit 1) latest on true
    left join lateral(select * from sources where source=n.source and status='SUCCEEDED' order by finished_at desc nulls last,id desc limit 1) ok on true
    left join lateral(select * from sources where source=n.source and status='FAILED' order by finished_at desc nulls last,id desc limit 1) failed on true order by n.source`);
  }
  return {
    identity,
    async auditSession(p: Principal, event: "SIGN_IN" | "SIGN_OUT") {
      await identity(p);
      await db.insert(s.auditEvents).values({
        actorId: p.actorId,
        action:
          event === "SIGN_IN" ? "dashboard.sign_in" : "dashboard.sign_out",
        subjectType: "actor",
        subjectId: p.actorId,
        correlationId: p.correlationId,
        metadata: {},
      });
    },
    async sites(p: Principal) {
      await identity(p);
      return db
        .select({
          id: s.sites.id,
          name: s.sites.name,
          canonicalOrigin: s.sites.canonicalOrigin,
          timezone: s.sites.timezone,
          status: s.sites.status,
        })
        .from(s.sites)
        .orderBy(s.sites.name)
        .limit(100);
    },
    async read(
      siteId: string,
      section: ControlSection,
      raw: unknown,
      p: Principal,
    ) {
      await identity(p);
      if (
        !(
          await db
            .select({ id: s.sites.id })
            .from(s.sites)
            .where(eq(s.sites.id, siteId))
        )[0]
      )
        return null;
      const f = controlFilterSchema.parse(raw),
        page = f.pageId
          ? sql`and p.id=${f.pageId}`
          : f.pageUrl
            ? sql`and p.normalized_url=${f.pageUrl}`
            : sql``,
        status = f.status ? sql`and status::text=${f.status}` : sql``;
      if (section === "freshness")
        return controlListSchema.parse({
          items: await freshness(siteId),
          hasMore: false,
          limit: f.limit,
          offset: 0,
          notes: [
            "Age is shown against a display threshold of seven days; this is not a new SEO alert rule.",
          ],
        });
      if (section === "overview") {
        const latest =
          (
            await rows(
              sql`select id,status::text,finished_at as "finishedAt",summary,error_code as "errorCode" from crawl_runs where site_id=${siteId} order by created_at desc,id desc limit 1`,
            )
          )[0] ?? null;
        const health = (
          await rows(sql`with latest as(select id from crawl_runs where site_id=${siteId} and status='SUCCEEDED' order by finished_at desc,id desc limit 1)
        select (select count(*) from page_snapshots where crawl_run_id=(select id from latest))::int as pages,
        (select count(*) from page_snapshots where crawl_run_id=(select id from latest) and is_indexable)::int as indexable,
        (select count(*) from issue_occurrences i join analysis_runs a on a.id=i.analysis_run_id join issue_definitions d on d.id=i.issue_definition_id where a.crawl_run_id=(select id from latest) and a.status='SUCCEEDED' and d.severity='CRITICAL')::int as critical,
        (select id from latest) as "crawlId",
        exists(select 1 from analysis_runs a where a.crawl_run_id=(select id from latest) and a.status='SUCCEEDED') as "analysisAvailable",
        (select count(*) from opportunities where site_id=${siteId} and status in ('OPEN','ACKNOWLEDGED'))::int as opportunities,
        (select count(*) from recommendations where site_id=${siteId} and state='READY_FOR_REVIEW')::int as reviews,
        (select count(distinct change_id) from measurement_plans mp join change_ledger_entries cl on cl.id=mp.change_id where cl.site_id=${siteId} and mp.completed_at is null)::int as measuring`)
        )[0]!;
        if (!health.analysisAvailable) health.critical = null;
        if (!health.crawlId) {
          health.pages = null;
          health.indexable = null;
          health.critical = null;
        }
        return controlListSchema.parse({
          items: await freshness(siteId),
          hasMore: false,
          limit: f.limit,
          offset: 0,
          summary: {
            latestCrawl: latest,
            ...health,
            recentAgents: await rows(
              sql`select id,status::text,created_at as "createdAt",error_code as "errorCode" from agent_runs where site_id=${siteId} order by created_at desc,id desc limit 5`,
            ),
            recentProblems: await rows(
              sql`select id,provider::text as source,status::text,error_code as "errorCode",finished_at as "finishedAt" from integration_sync_runs where site_id=${siteId} and status in ('FAILED','PARTIAL') order by created_at desc,id desc limit 5`,
            ),
          },
          notes: [
            "Counts use the latest successful crawl; the latest attempt may be partial or failed.",
            "Approval records a decision. Website changes are applied manually elsewhere.",
          ],
        });
      }
      if (section === "crawls")
        return list(
          sql`select id,start_url as label,status::text,created_at::text as at,jsonb_build_object('summary',summary,'startedAt',started_at,'finishedAt',finished_at,'errorCode',error_code) as data from crawl_runs where site_id=${siteId} ${status} order by created_at desc,id desc limit ${f.limit + 1} offset ${f.offset}`,
          f,
        );
      if (section === "issues") {
        const crawl = f.crawlId
          ? sql`${f.crawlId}::uuid`
          : sql`(select c.id from crawl_runs c join analysis_runs a on a.crawl_run_id=c.id where c.site_id=${siteId} and c.status='SUCCEEDED' and a.status='SUCCEEDED' order by c.finished_at desc,c.id desc limit 1)`;
        return list(
          sql`with chosen as(select c.id,c.created_at from crawl_runs c where c.site_id=${siteId} and c.id=${crawl} and c.status='SUCCEEDED' and exists(select 1 from analysis_runs ar where ar.crawl_run_id=c.id and ar.status='SUCCEEDED')), history as(
          select i.*,d.code,d.severity,d.remediation,a.crawl_run_id,c.created_at as run_at from issue_occurrences i join issue_definitions d on d.id=i.issue_definition_id join analysis_runs a on a.id=i.analysis_run_id join crawl_runs c on c.id=a.crawl_run_id where c.site_id=${siteId} and c.status='SUCCEEDED' and a.status='SUCCEEDED' and c.created_at <= (select created_at from chosen)
        ), ranked as(select *,row_number() over(partition by fingerprint order by run_at desc,detected_at desc,id desc) as rank,min(detected_at) over(partition by fingerprint) as first_at from history), findings as(
          select i.id,i.code as label,p.normalized_url as url,i.severity::text as severity,i.code as kind,
          case when i.crawl_run_id=(select id from chosen) then 'OBSERVED' else 'NOT_OBSERVED' end as status,i.detected_at::text as at,
          jsonb_build_object('evidence',i.evidence,'remediation',i.remediation,'firstDetected',i.first_at,'lastDetected',i.detected_at,'pageId',i.page_id,'crawlId',i.crawl_run_id,'comparisonCrawlId',(select id from chosen)) as data
          from ranked i left join pages p on p.id=i.page_id where rank=1 ${page} ${f.type ? sql`and i.code=${f.type}` : sql``} ${f.severity ? sql`and i.severity::text=${f.severity}` : sql``})
          select * from findings where true ${status} order by case severity when 'CRITICAL' then 0 when 'ERROR' then 1 when 'WARNING' then 2 else 3 end,at desc,id limit ${f.limit + 1} offset ${f.offset}`,
          f,
          [
            "NOT_OBSERVED means absent from the selected successful crawl, not verified resolution; partial crawl coverage can hide a page.",
          ],
        );
      }
      if (section === "performance") return performance(siteId, f);
      if (section === "opportunities")
        return list(
          sql`select o.id,o.type::text as label,o.type::text as kind,o.status::text,o.url,o.score,o.last_detected_at::text as at,jsonb_build_object('pageId',o.page_id,'query',q.display_query,'components',v.observation->'components','candidateOnly',v.observation->'candidateOnly') as data from opportunities o left join search_queries q on q.id=o.query_id left join lateral(select observation from opportunity_scores where opportunity_id=o.id and run_id=o.last_run_id order by created_at desc,id desc limit 1) v on true where o.site_id=${siteId} ${f.status ? sql`and o.status::text=${f.status}` : sql``} ${f.type ? sql`and o.type::text=${f.type}` : sql``} ${f.pageId ? sql`and o.page_id=${f.pageId}` : f.pageUrl ? sql`and o.url=${f.pageUrl}` : sql``} ${f.minScore !== undefined ? sql`and o.score>=${f.minScore}` : sql``} order by ${f.sort === "recent" ? sql`o.last_detected_at desc` : sql`o.score desc`},o.id limit ${f.limit + 1} offset ${f.offset}`,
          f,
        );
      if (section === "agents")
        return list(
          sql`select r.id,coalesce(v.analysis->>'summary',r.outcome,'Agent analysis') as label,r.status::text,r.created_at::text as at,'SUPERVISOR' as kind,jsonb_build_object('opportunityId',r.opportunity_id,'startedAt',r.started_at,'finishedAt',r.finished_at,'bookedNanousd',r.booked_nanousd::text,'errorCode',r.error_code,'provider',inv.provider,'model',inv.model,'inputTokens',inv.input_tokens,'outputTokens',inv.output_tokens) as data from agent_runs r left join lateral(select analysis from agent_outputs where run_id=r.id and draft is not null limit 1) v on true left join lateral(select provider,model,input_tokens,output_tokens from agent_invocations where run_id=r.id order by started_at desc,id desc limit 1) inv on true where r.site_id=${siteId} ${f.status ? sql`and r.status::text=${f.status}` : sql``} ${f.opportunityId ? sql`and r.opportunity_id=${f.opportunityId}` : sql``} order by r.created_at desc,r.id desc limit ${f.limit + 1} offset ${f.offset}`,
          f,
          [
            "Token counts and model show the latest invocation. Booked cost is the run's conservative nanodollar estimate, not an invoice.",
          ],
        );
      if (section === "recommendations")
        return list(
          sql`select r.id,r.change_type as label,r.change_type as kind,r.state::text as status,p.normalized_url as url,r.updated_at::text as at,v.confidence as score,jsonb_build_object('risk',v.risk,'mode',r.mode,'version',v.number,'topic',v.proposal->>'topic','pageId',r.page_id) as data from recommendations r join recommendation_versions v on v.id=r.current_version_id join pages p on p.id=r.page_id where r.site_id=${siteId} ${f.status ? sql`and r.state::text=${f.status}` : sql``} ${f.type ? sql`and v.risk::text=${f.type}` : sql``} ${page} order by r.updated_at desc,r.id desc limit ${f.limit + 1} offset ${f.offset}`,
          f,
        );
      if (section === "changes" || section === "measurements")
        return list(
          sql`select c.id,r.change_type as label,r.change_type as kind,p.normalized_url as url,c.implemented_at::text as at,
        case when exists(select 1 from change_events where change_id=c.id and type='REVERT') then 'REVERTED' else 'IMPLEMENTED' end as status,
        jsonb_build_object('mode',c.mode,'risk',v.risk,'confidence',v.confidence,'topic',v.proposal->>'topic','metric',v.proposal->'rule'->>'primary','recommendationId',r.id,'plans',(select jsonb_agg(jsonb_build_object('horizon',horizon,'dueAt',due_at,'completedAt',completed_at)) from measurement_plans where change_id=c.id)) as data
        from change_ledger_entries c join recommendations r on r.id=c.recommendation_id join recommendation_versions v on v.id=c.version_id join pages p on p.id=c.page_id where c.site_id=${siteId} ${page} ${f.status ? sql`and (case when exists(select 1 from change_events where change_id=c.id and type='REVERT') then 'REVERTED' else 'IMPLEMENTED' end)=${f.status}` : sql``} order by c.implemented_at desc,c.id desc limit ${f.limit + 1} offset ${f.offset}`,
          f,
        );
      return list(
        sql`with signals as(
        select id,'Crawler failure' as label,'CRAWL' as kind,status::text,created_at::text as at,'ERROR' as severity,jsonb_build_object('errorCode',error_code) as data from crawl_runs where site_id=${siteId} and status in ('FAILED','PARTIAL')
        union all select id,provider::text || ' sync problem','IMPORT',status::text,created_at::text,'ERROR',jsonb_build_object('errorCode',error_code,'dimensionSet',dimension_set) from integration_sync_runs where site_id=${siteId} and status in ('FAILED','PARTIAL')
        union all select id,'Agent analysis failure','AGENT',status::text,created_at::text,'ERROR',jsonb_build_object('errorCode',error_code) from agent_runs where site_id=${siteId} and status='FAILED'
        union all select id,'Opportunity detection failure','OPPORTUNITY',status::text,created_at::text,'ERROR',jsonb_build_object('errorCode',error_code) from opportunity_runs where site_id=${siteId} and status='FAILED'
      ) select * from signals where true ${status} ${f.severity ? sql`and severity=${f.severity}` : sql``} order by at desc,id desc limit ${f.limit + 1} offset ${f.offset}`,
        f,
        [
          "Existing run failures only. Technical findings are in Health. No spike, commercial-page or new critical-regression alert rules are implemented.",
        ],
      );
    },
    async detail(
      siteId: string,
      section: ControlSection,
      id: string,
      p: Principal,
    ) {
      await identity(p);
      if (section === "opportunities") return opportunities.detail(siteId, id);
      if (section === "recommendations") {
        const detail = await workflow.detail(siteId, id, p);
        if (!detail) return null;
        const source = (
          await db
            .select({
              analysis: s.agentOutputs.analysis,
              createdAt: s.agentOutputs.createdAt,
              provider: s.agentInvocations.provider,
              model: s.agentInvocations.model,
              promptVersion: s.agentInvocations.promptVersion,
              schemaVersion: s.agentInvocations.schemaVersion,
            })
            .from(s.agentOutputs)
            .innerJoin(
              s.agentInvocations,
              eq(s.agentInvocations.id, s.agentOutputs.invocationId),
            )
            .where(eq(s.agentOutputs.id, detail.agentOutputId))
        )[0];
        const page = (
          await db
            .select({ url: s.pages.normalizedUrl })
            .from(s.pages)
            .where(
              and(eq(s.pages.id, detail.pageId), eq(s.pages.siteId, siteId)),
            )
        )[0];
        const version = detail.versions.find(
          (v) => v.id === detail.currentVersionId,
        )!;
        const actions: string[] = [];
        for (const action of [
          "SUBMIT",
          "APPROVE",
          "REJECT",
          "REQUEST_CHANGES",
          "CANCEL",
        ] as const) {
          try {
            requireRole(
              p,
              ["SUBMIT", "CANCEL"].includes(action)
                ? "OPERATOR"
                : approvalRole(version.risk),
            );
            nextRecommendationState(detail.state, action);
            actions.push(action);
          } catch {
            /* Permission/state mismatch is reflected as unavailable; mutations still validate again. */
          }
        }
        const operator = p.roles.includes("OPERATOR");
        return {
          ...detail,
          source,
          page,
          capabilities: {
            actions,
            canImplement: operator && detail.state === "APPROVED",
            canRevise:
              operator &&
              ["DRAFT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"].includes(
                detail.state,
              ),
          },
        };
      }
      if (section === "changes" || section === "measurements") {
        const detail = await workflow.ledger(siteId, id, p);
        if (!detail) return null;
        const history = await measurement.history(siteId, id, p);
        const actorIds = [
          detail.implementedBy,
          detail.approval?.actorId,
          detail.version?.createdBy,
        ].filter((x): x is string => Boolean(x));
        const actors = await rows(
          sql`select id,display_name as name from actors where id in (${sql.join(
            actorIds.map((x) => sql`${x}::uuid`),
            sql`,`,
          )}) limit 3`,
        );
        const page = (
          await db
            .select({ url: s.pages.normalizedUrl })
            .from(s.pages)
            .where(
              and(eq(s.pages.id, detail.pageId), eq(s.pages.siteId, siteId)),
            )
        )[0];
        return {
          ...detail,
          baselines: detail.baselines.map((b) => ({
            ...b,
            sample: summarizedSample(b.sample),
          })),
          history: history
            ? {
                ...history,
                results: history.results.map((item) => ({
                  ...item,
                  result: {
                    ...item.result,
                    comparison: summarizedSample(item.result.comparison),
                  },
                })),
              }
            : null,
          provenanceLimit: 100,
          actors,
          page,
          recordState: detail.events.some((event) => event.type === "REVERT")
            ? "REVERTED"
            : "IMPLEMENTED",
        };
      }
      if (section === "agents") {
        const run = (
          await db
            .select({
              id: s.agentRuns.id,
              opportunityId: s.agentRuns.opportunityId,
              status: s.agentRuns.status,
              createdAt: s.agentRuns.createdAt,
              startedAt: s.agentRuns.startedAt,
              finishedAt: s.agentRuns.finishedAt,
              bookedNanousd: s.agentRuns.bookedNanousd,
              errorCode: s.agentRuns.errorCode,
            })
            .from(s.agentRuns)
            .where(and(eq(s.agentRuns.id, id), eq(s.agentRuns.siteId, siteId)))
        )[0];
        if (!run) return null;
        const outputs = await db
          .select()
          .from(s.agentOutputs)
          .where(eq(s.agentOutputs.runId, id))
          .limit(20);
        const invocations = await db
          .select({
            agent: s.agentInvocations.agentType,
            provider: s.agentInvocations.provider,
            model: s.agentInvocations.model,
            status: s.agentInvocations.status,
            inputTokens: s.agentInvocations.inputTokens,
            outputTokens: s.agentInvocations.outputTokens,
            costNanousd: s.agentInvocations.costNanousd,
            durationMs: s.agentInvocations.durationMs,
            errorCode: s.agentInvocations.errorCode,
            promptVersion: s.agentInvocations.promptVersion,
            schemaVersion: s.agentInvocations.schemaVersion,
          })
          .from(s.agentInvocations)
          .where(eq(s.agentInvocations.runId, id))
          .limit(50);
        const evidence =
          (
            await db
              .select({ bundle: s.agentEvidence.bundle })
              .from(s.agentEvidence)
              .where(eq(s.agentEvidence.runId, id))
          )[0]?.bundle ?? null;
        return {
          ...run,
          outputs,
          invocations,
          evidence,
          ruleHints: outputs.map((o) => ({
            outputId: o.id,
            rule: defaultRule(o.analysis.expectedMetric),
          })),
        };
      }
      if (section === "crawls") {
        const run = (
          await db
            .select({
              id: s.crawlRuns.id,
              status: s.crawlRuns.status,
              summary: s.crawlRuns.summary,
              startedAt: s.crawlRuns.startedAt,
              finishedAt: s.crawlRuns.finishedAt,
              errorCode: s.crawlRuns.errorCode,
            })
            .from(s.crawlRuns)
            .where(and(eq(s.crawlRuns.id, id), eq(s.crawlRuns.siteId, siteId)))
        )[0];
        return run ?? null;
      }
      if (section === "issues") {
        return (
          (
            await rows(
              sql`select i.evidence,d.remediation,d.code,d.rule_version as "ruleVersion",p.normalized_url as url,i.detected_at as "detectedAt",a.crawl_run_id as "crawlId" from issue_occurrences i join analysis_runs a on a.id=i.analysis_run_id join crawl_runs c on c.id=a.crawl_run_id join issue_definitions d on d.id=i.issue_definition_id left join pages p on p.id=i.page_id where i.id=${id} and c.site_id=${siteId}`,
            )
          )[0] ?? null
        );
      }
      return null;
    },
  };
  async function performance(siteId: string, f: ControlFilter) {
    const end =
        f.endDate ??
        new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
      start =
        f.startDate ??
        new Date(Date.parse(end) - 27 * 86400000).toISOString().slice(0, 10);
    const notes = [
      `UTC dates ${start} through ${end}. Only rows from successful imports are used. Missing dates are not zero.`,
      "GSC dimension sets stay separate; PAGE/QUERY/PAGE_QUERY are never added together. GA4 users are summed daily users, not unique users across the period.",
    ];
    if (f.dataset === "PAGESPEED")
      return list(
        sql`select m.id,m.normalized_url as label,m.normalized_url as url,m.strategy as kind,m.collected_at::text as at,jsonb_build_object('performanceScore',m.performance_score,'labLcpMs',m.lcp_ms,'labInpMs',m.inp_ms,'labCls',m.cls,'fieldAvailable',m.field_data_available,'fieldLcpMs',m.field_lcp_ms,'fieldInpMs',m.field_inp_ms,'fieldCls',m.field_cls,'syncRunId',m.sync_run_id) as data from pagespeed_snapshots m join integration_sync_runs r on r.id=m.sync_run_id where m.site_id=${siteId} and r.status='SUCCEEDED' and m.strategy=${f.strategy} and m.collected_at>=${start}::date and m.collected_at<${end}::date+interval '1 day' ${f.pageId ? sql`and m.page_id=${f.pageId}` : f.pageUrl ? sql`and m.normalized_url=${f.pageUrl}` : sql``} order by m.collected_at desc,m.id desc limit ${f.limit + 1} offset ${f.offset}`,
        f,
        [
          ...notes,
          "Lab and field metrics are distinct; an absent field sample is unavailable.",
        ],
        { startDate: start, endDate: end, dataset: f.dataset },
      );
    const table =
      f.dataset === "GA4"
        ? sql`ga4_page_daily`
        : f.dataset === "QUERY"
          ? sql`gsc_query_daily`
          : f.dataset === "PAGE_QUERY"
            ? sql`gsc_page_query_daily`
            : sql`gsc_page_daily`;
    const key =
      f.dataset === "QUERY"
        ? sql`m.query_id::text`
        : f.dataset === "PAGE_QUERY"
          ? sql`m.normalized_url || ' | ' || m.query_id::text`
          : sql`m.normalized_url`;
    const label =
      f.dataset === "QUERY"
        ? sql`q.display_query`
        : f.dataset === "PAGE_QUERY"
          ? sql`m.normalized_url || ' · ' || q.display_query`
          : sql`m.normalized_url`;
    const dims =
      f.dataset === "GA4"
        ? sql`and m.channel='Organic Search' and m.dimension_version='ga4-organic-landing-v1'`
        : sql`and m.data_state='final' and m.search_type='web'`;
    const aggregate =
      f.dataset === "GA4"
        ? sql`jsonb_build_object('sessions',sum(m.sessions),'dailyUsersSum',sum(m.total_users),'keyEvents',sum(m.key_events),'engagementRate',sum(m.engaged_sessions)/nullif(sum(m.sessions),0),'observedDays',count(distinct m.date))`
        : sql`jsonb_build_object('clicks',sum(m.clicks),'impressions',sum(m.impressions),'ctr',sum(m.clicks)/nullif(sum(m.impressions),0),'position',sum(m.position*m.impressions)/nullif(sum(m.impressions),0),'observedDays',count(distinct m.date))`;
    const filter = sql`m.site_id=${siteId} and r.status='SUCCEEDED' and m.date between ${start}::date and ${end}::date ${dims} ${f.pageId && f.dataset !== "QUERY" ? sql`and m.page_id=${f.pageId}` : f.pageUrl && f.dataset !== "QUERY" ? sql`and m.normalized_url=${f.pageUrl}` : sql``}`;
    const summary = (
      await rows(
        sql`select ${aggregate} as metrics from ${table} m join integration_sync_runs r on r.id=m.sync_run_id where ${filter}`,
      )
    )[0]?.metrics;
    const trend = await rows(
      sql`select m.date::text as date,${aggregate} as metrics from ${table} m join integration_sync_runs r on r.id=m.sync_run_id where ${filter} group by m.date order by m.date`,
    );
    return list(
      sql`select ${key} as id,${label} as label,${aggregate} as data from ${table} m join integration_sync_runs r on r.id=m.sync_run_id ${f.dataset === "QUERY" || f.dataset === "PAGE_QUERY" ? sql`join search_queries q on q.id=m.query_id` : sql``} where ${filter} group by ${key},${label} order by ${f.dataset === "GA4" ? sql`sum(m.sessions) desc` : sql`sum(m.clicks) desc`},${key} limit ${f.limit + 1} offset ${f.offset}`,
      f,
      notes,
      {
        startDate: start,
        endDate: end,
        dataset: f.dataset,
        metrics: summary,
        trend,
      },
    );
  }
}
