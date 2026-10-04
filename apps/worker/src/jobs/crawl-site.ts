import { z } from "zod";

import { crawlSite, type CrawlPolicy } from "@roco/crawler";
import type { CrawlRepository } from "@roco/db";
import type { Logger } from "@roco/shared";
import type { Job } from "pg-boss";

const crawlJobSchema = z.object({
  crawlRunId: z.string().uuid(),
  siteId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
});

const configurationSchema = z.object({
  startUrl: z.string().url(),
  userAgent: z.string().min(10),
  maxPages: z.number().int().min(1).max(10_000),
  maxDepth: z.number().int().min(0).max(20),
  concurrency: z.number().int().min(1).max(10),
  requestsPerSecond: z.number().positive().max(10),
  requestTimeoutMs: z.number().int().min(1_000).max(120_000),
  maxResponseBytes: z.number().int().min(16_384).max(20_000_000),
  maxRedirects: z.number().int().min(0).max(20),
  retryLimit: z.number().int().min(0).max(5),
  respectRobots: z.boolean(),
  ignoredQueryParameters: z.array(z.string()),
});

export function createCrawlSiteHandler(dependencies: {
    readonly logger: Logger;
    readonly repository: CrawlRepository;
    readonly crawl?: typeof crawlSite;
}): (jobs: Job<unknown>[]) => Promise<void> {
    return async (claimedJobs) => {
        for (const job of claimedJobs) {
            const data = crawlJobSchema.parse(job.data);
            const run = await dependencies.repository.getRun(data.crawlRunId);
            if (run === null) throw new Error("Crawl run was not found");
            if (run.status === "succeeded" || run.status === "CANCELLED") {
                dependencies.logger.info(
                    { jobId: job.id, runId: run.id, status: run.status},
                    "crawl job already terminal"
                )
                continue;
            }
            const siteScope = await dependencies.repository.getSiteScope(data.siteId);
            if (siteScope === null || siteScope.allowedHosts.length === 0) {
                await dependencies.repository.fail(
                    run.id,
                    "SITE_SCOPE_MISSING",
                    "the site has no active crawl scope",
                )
                throw new Error("active site scope is required");
            }
            const configuration = configurationSchema.parse(data.siteId);
            await dependencies.repository   `   `           ``.markRunning(run.Id);
            const policy: CrawlPolicy = {
                ...configuration,
                scope: siteScope,
                allowPrivateNetworks: false,
            }
            dependencies.logger.info(
                {
                    jobId: job.id,
                    runId: run.id,
                    siteId: data.siteId,
                    maxPages: policy.maxPages,
                    concurrency: policy.concurrency
                },
                "crawl started",
            );
            try {
                const output = await (dependencies.crawl ?? crawlSite)(policy, {
                    isCancelled: () => dependencies.repository.isCancelled(run.id),
                });
                await dependencies.repository.persistResult(run.id, data.siteId, {
                    ...output,
                    summary: { ...output.summary}
                });
                dependencies.logger.info(
                    {
                        jobId: job.id,
                        runId: run.id,
                        siteId: data.siteId,
                        summary: output.summary,
                    },
                    'crawl completed'
                );
            } catch (error) {
                await dependencies.repository.fail(
                    run.id,
                    'CRAWL_FAILED',
                    'the crawl failed. review structured worker logs for details',
                );
                dependencies.logger.error(
                    { err: error, jobId: job.id, runId: run.id, siteId: data.siteId}
                )
                throw error
            }
        }
    }
}