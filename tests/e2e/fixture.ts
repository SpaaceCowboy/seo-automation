import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../../packages/db/src/index.js";
type Pool = DatabaseClient["pool"];
import { output } from "../../packages/agents/test/fixtures.js";
import { fixture, config } from "../../packages/opportunities/test/fixtures.js";
import {
  detectOpportunities,
  configSchema,
} from "../../packages/opportunities/src/index.js";
export async function seedControl(pool: Pool) {
  const pageHash = randomUUID();
  const siteId = randomUUID(),
    pageId = randomUUID(),
    opportunityId = randomUUID(),
    scoreId = randomUUID(),
    opRunId = randomUUID(),
    cfgId = randomUUID(),
    agentRunId = randomUUID(),
    invocationId = randomUUID(),
    agentOutputId = randomUUID(),
    operatorId = randomUUID(),
    reviewerId = randomUUID(),
    specialId = randomUUID(),
    serviceId = randomUUID(),
    origin = `https://${randomUUID()}.example.test`;
  await pool.query(
    "insert into sites(id,name,canonical_origin,timezone) values($1,'Workflow sandbox',$2,'UTC')",
    [siteId, origin],
  );
  await pool.query("insert into site_hosts(site_id,host) values($1,$2)", [
    siteId,
    new URL(origin).hostname,
  ]);
  for (const [id, kind] of [
    [operatorId, "HUMAN"],
    [reviewerId, "HUMAN"],
    [specialId, "HUMAN"],
    [serviceId, "SERVICE"],
  ])
    await pool.query(
      "insert into actors(id,type,display_name) values($1,$2,'Fixture actor')",
      [id, kind],
    );
  await pool.query(
    "insert into pages(id,site_id,normalized_url,normalized_url_hash,normalization_version) values($1,$2,$3,$4,'url-v1')",
    [pageId, siteId, `${origin}/fa/article`, pageHash],
  );
  await pool.query(
    "insert into scoring_configs(id,site_id,content_hash,version,configuration) values($1,$2,$3,'fixture',$4)",
    [cfgId, siteId, randomUUID(), JSON.stringify(configSchema.parse({}))],
  );
  await pool.query(
    "insert into opportunity_runs(id,site_id,config_id,idempotency_key,detector_version,start_date,end_date,status,correlation_id) values($1,$2,$3,$4,'opportunities-v1','2026-09-22','2026-09-28','SUCCEEDED','fixture')",
    [opRunId, siteId, cfgId, randomUUID()],
  );
  const candidate = detectOpportunities(fixture(), config).candidates.find(
    (c) => c.type === "CTR",
  )!;
  candidate.pageId = pageId;
  candidate.url = `${origin}/fa/article`;
  await pool.query(
    "insert into opportunities(id,site_id,fingerprint,type,page_id,url,score,last_run_id) values($1,$2,$3,'CTR',$4,$5,$6,$7)",
    [
      opportunityId,
      siteId,
      randomUUID(),
      pageId,
      candidate.url,
      candidate.score,
      opRunId,
    ],
  );
  await pool.query(
    "insert into opportunity_scores(id,opportunity_id,run_id,config_id,score,observation) values($1,$2,$3,$4,$5,$6)",
    [
      scoreId,
      opportunityId,
      opRunId,
      cfgId,
      candidate.score,
      JSON.stringify(candidate),
    ],
  );
  await pool.query(
    "insert into agent_runs(id,site_id,opportunity_id,score_id,actor_id,idempotency_key,correlation_id,status,prompt_version,schema_version) values($1,$2,$3,$4,$5,$6,'fixture','SUCCEEDED','seo-prompts-v1','seo-agent-v1')",
    [agentRunId, siteId, opportunityId, scoreId, operatorId, randomUUID()],
  );
  await pool.query(
    "insert into agent_invocations(id,run_id,agent_type,budget_month,attempt,provider,model,prompt_version,schema_version,input_hash,status,reserved_nanousd) values($1,$2,'SUPERVISOR','2026-10',0,'fixture','fixture-v1','seo-prompts-v1','seo-agent-v1','fixture','SUCCEEDED',0)",
    [invocationId, agentRunId],
  );
  const analysis = output();
  analysis.opportunityId = opportunityId;
  analysis.summary = "Review title clarity using stored CTR evidence";
  analysis.actions[0]!.type = "TITLE";
  analysis.actions[0]!.targetPageId = pageId;
  analysis.risk = "MEDIUM";
  await pool.query(
    "insert into agent_outputs(id,run_id,invocation_id,schema_version,analysis,draft) values($1,$2,$3,'seo-agent-v1',$4,$5)",
    [
      agentOutputId,
      agentRunId,
      invocationId,
      JSON.stringify(analysis),
      JSON.stringify({ status: "DRAFT", executable: false, analysis }),
    ],
  );

  await pool.query(
    "update sites set name='Phase 7 control sandbox' where id=$1",
    [siteId],
  );
  const crawlId = randomUUID(),
    analysisId = randomUUID(),
    definitionId = randomUUID();
  await pool.query(
    "insert into crawl_runs(id,site_id,start_url,idempotency_key,config_snapshot,status,finished_at,summary) values($1,$2,$3,$4,'{}','SUCCEEDED',now(),'{\"pagesFetched\":1}')",
    [crawlId, siteId, origin, randomUUID()],
  );
  await pool.query(
    "insert into page_snapshots(crawl_run_id,page_id,observed_url,http_status,fetch_status,response_ms,robots_allowed,is_indexable,indexability_reason,crawl_depth,parser_version,fetched_at,title) values($1,$2,$3,200,'SUCCESS',40,true,true,'INDEXABLE',1,'fixture',now(),'Old title')",
    [crawlId, pageId, candidate.url],
  );
  await pool.query(
    "insert into analysis_runs(id,crawl_run_id,ruleset_version,status,finished_at) values($1,$2,'fixture','SUCCEEDED',now())",
    [analysisId, crawlId],
  );
  await pool.query(
    "insert into issue_definitions(id,code,rule_version,severity,remediation) values($1,'MISSING_META_DESCRIPTION',$2,'WARNING','Add a useful description')",
    [definitionId, randomUUID()],
  );
  await pool.query(
    "insert into issue_occurrences(analysis_run_id,issue_definition_id,page_id,fingerprint,evidence) values($1,$2,$3,$4,'{\"metaDescription\":null}')",
    [analysisId, definitionId, pageId, randomUUID()],
  );
  const syncId = randomUUID();
  const end = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    start = new Date(Date.parse(end) - 27 * 86400000)
      .toISOString()
      .slice(0, 10);
  await pool.query(
    "insert into integration_sync_runs(id,site_id,provider,job_type,dimension_set,start_date,end_date,status,idempotency_key,finished_at) values($1,$2,'GSC','sync','PAGE',$3,$4,'SUCCEEDED',$5,now())",
    [syncId, siteId, start, end, randomUUID()],
  );
  for (let i = 0; i < 28; i++) {
    const date = new Date(Date.parse(start) + i * 86400000)
      .toISOString()
      .slice(0, 10);
    await pool.query(
      "insert into gsc_page_daily(site_id,sync_run_id,page_id,observed_url,normalized_url,normalized_url_hash,normalization_version,date,clicks,impressions,ctr,position) values($1,$2,$3,$4,$4,$5,'url-v1',$6,2,100,0.02,7)",
      [siteId, syncId, pageId, candidate.url, pageHash, date],
    );
  }
  const ga4Id = randomUUID(),
    psiId = randomUUID();
  await pool.query(
    "insert into integration_sync_runs(id,site_id,provider,job_type,start_date,end_date,status,idempotency_key,created_at,finished_at) values($1,$2,'GA4','sync',$3,$4,'SUCCEEDED',$5,now()-interval '1 hour',now()-interval '1 hour')",
    [ga4Id, siteId, start, end, randomUUID()],
  );
  await pool.query(
    "insert into ga4_page_daily(site_id,sync_run_id,page_id,date,observed_landing_page,normalized_url,normalized_url_hash,normalization_version,dimension_version,sessions,total_users,engaged_sessions,engagement_rate,key_events) values($1,$2,$3,$4,$5,$5,$6,'url-v1','ga4-organic-landing-v1',10,6,7,0.7,2)",
    [siteId, ga4Id, pageId, end, candidate.url, pageHash],
  );
  await pool.query(
    "insert into integration_sync_runs(id,site_id,provider,job_type,status,idempotency_key,finished_at) values($1,$2,'PAGESPEED','collect','SUCCEEDED',$3,now())",
    [psiId, siteId, randomUUID()],
  );
  await pool.query(
    "insert into pagespeed_snapshots(site_id,sync_run_id,page_id,observed_url,normalized_url,normalized_url_hash,normalization_version,strategy,collected_at,performance_score,lcp_ms,field_data_available,api_version) values($1,$2,$3,$4,$4,$5,'url-v1','mobile',$6,0.91,1100,false,'fixture')",
    [siteId, psiId, pageId, candidate.url, pageHash, end + "T12:00:00Z"],
  );
  await pool.query(
    "insert into integration_sync_runs(site_id,provider,job_type,status,idempotency_key,error_code,finished_at) values($1,'GA4','sync','FAILED',$2,'GOOGLE_UNAVAILABLE',now())",
    [siteId, randomUUID()],
  );
  const rejectionRunId = randomUUID(),
    rejectionInvocationId = randomUUID(),
    rejectionOutputId = randomUUID();
  await pool.query(
    "insert into agent_runs(id,site_id,opportunity_id,score_id,actor_id,idempotency_key,correlation_id,status,prompt_version,schema_version,finished_at) values($1,$2,$3,$4,$5,$6,'fixture','SUCCEEDED','seo-prompts-v1','seo-agent-v1',now())",
    [rejectionRunId, siteId, opportunityId, scoreId, operatorId, randomUUID()],
  );
  await pool.query(
    "insert into agent_invocations(id,run_id,agent_type,budget_month,attempt,provider,model,prompt_version,schema_version,input_hash,status,reserved_nanousd) values($1,$2,'SUPERVISOR','2026-10',0,'fixture','fixture-v1','seo-prompts-v1','seo-agent-v1','fixture','SUCCEEDED',0)",
    [rejectionInvocationId, rejectionRunId],
  );
  const rejection = {
    ...analysis,
    summary: "Second title candidate for rejection",
  };
  await pool.query(
    "insert into agent_outputs(id,run_id,invocation_id,schema_version,analysis,draft) values($1,$2,$3,'seo-agent-v1',$4,$5)",
    [
      rejectionOutputId,
      rejectionRunId,
      rejectionInvocationId,
      JSON.stringify(rejection),
      JSON.stringify({
        status: "DRAFT",
        executable: false,
        analysis: rejection,
      }),
    ],
  );
  return {
    siteId,
    pageId,
    opportunityId,
    rejectionRunId,
    agentRunId,
    agentOutputId,
    operatorId,
    reviewerId,
    specialId,
    serviceId,
    crawlId,
    url: candidate.url,
  };
}
