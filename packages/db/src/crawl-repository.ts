import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  TECHNICAL_RULESET_VERSION,
  URL_NORMALIZATION_VERSION,
} from "@roco/seo-core";

import * as schema from "./schema.js";

export interface CrawlRunConfiguration {
  readonly startUrl: string;
  readonly userAgent: string;
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly concurrency: number;
  readonly requestsPerSecond: number;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly retryLimit: number;
  readonly respectRobots: boolean;
  readonly ignoredQueryParameters: readonly string[];
}

export interface CrawlRunRecord {
  readonly id: string;
  readonly siteId: string;
  readonly status: (typeof schema.crawlRuns.$inferSelect)["status"];
  readonly startUrl: string;
  readonly configSnapshot: Record<string, unknown>;
  readonly summary: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface CrawlPersistenceOutput {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly pages: readonly {
    readonly observedUrl: string;
    readonly normalizedUrl: string;
    readonly normalizedUrlHash: string;
    readonly normalizationVersion: string;
    readonly finalUrl: string | null;
    readonly httpStatus: number | null;
    readonly fetchStatus: (typeof schema.pageSnapshots.$inferInsert)["fetchStatus"];
    readonly contentType: string | null;
    readonly responseMs: number;
    readonly redirectHops: readonly {
      readonly hopIndex: number;
      readonly sourceUrl: string;
      readonly destinationUrl: string;
      readonly httpStatus: number;
      readonly responseMs: number;
    }[];
    readonly canonicalUrl: string | null;
    readonly metaRobots: readonly string[];
    readonly xRobotsTag: readonly string[];
    readonly robotsAllowed: boolean;
    readonly isIndexable: boolean;
    readonly indexabilityReason: string;
    readonly title: string | null;
    readonly metaDescription: string | null;
    readonly headings: readonly {
      readonly level: 1 | 2;
      readonly position: number;
      readonly text: string;
    }[];
    readonly schemaTypes: readonly string[];
    readonly hasBreadcrumbs: boolean;
    readonly images: readonly {
      readonly sourceUrl: string | null;
      readonly altText: string | null;
      readonly hasAltAttribute: boolean;
    }[];
    readonly links: readonly {
      readonly normalizedUrl: string;
      readonly anchorText: string | null;
      readonly rel: string | null;
      readonly isInternal: boolean;
    }[];
    readonly wordCount: number;
    readonly contentHash: string | null;
    readonly htmlHash: string | null;
    readonly depth: number;
    readonly inSitemap: boolean;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
  }[];
  readonly robots: {
    readonly url: string;
    readonly status: number | null;
    readonly contentHash: string | null;
    readonly fetchedAt: Date;
    readonly sitemaps: readonly string[];
    readonly crawlDelaySeconds: number | null;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
  };
  readonly sitemaps: readonly {
    readonly url: string;
    readonly parentUrl: string | null;
    readonly status: number | null;
    readonly contentHash: string | null;
    readonly documentType: string;
    readonly entries: readonly {
      readonly url: string;
      readonly lastModified: string | null;
    }[];
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
  }[];
  readonly issues: readonly {
    readonly code: string;
    readonly severity: (typeof schema.issueDefinitions.$inferInsert)["severity"];
    readonly ruleVersion: string;
    readonly pageUrl: string | null;
    readonly evidence: Record<string, unknown>;
    readonly remediation: string;
    readonly fingerprint: string;
  }[];
  readonly pageMetrics: readonly {
    readonly pageUrl: string;
    readonly crawlDepth: number;
    readonly incomingInternalLinks: number;
    readonly outgoingInternalLinks: number;
    readonly isOrphan: boolean;
  }[];
  readonly summary: Record<string, unknown>;
}

export interface CrawlRepository {
  createRun(input: {
    siteId: string;
    idempotencyKey: string;
    trigger: "MANUAL" | "SCHEDULED" | "RETRY";
    configuration: CrawlRunConfiguration;
  }): Promise<CrawlRunRecord>;
  getRun(runId: string): Promise<CrawlRunRecord | null>;
  getSiteScope(siteId: string): Promise<{
    canonicalOrigin: string;
    allowedHosts: { host: string; includeSubdomains: boolean }[];
  } | null>;
  markRunning(runId: string): Promise<boolean>;
  cancel(runId: string): Promise<boolean>;
  isCancelled(runId: string): Promise<boolean>;
  persistResult(
    runId: string,
    siteId: string,
    output: CrawlPersistenceOutput,
  ): Promise<void>;
  fail(runId: string, code: string, safeMessage: string): Promise<void>;
}

function toRun(row: typeof schema.crawlRuns.$inferSelect): CrawlRunRecord {
  return {
    id: row.id,
    siteId: row.siteId,
    status: row.status,
    startUrl: row.startUrl,
    configSnapshot: row.configSnapshot,
    summary: row.summary,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function createCrawlRepository(
  db: NodePgDatabase<typeof schema>,
): CrawlRepository {
  return {
    async createRun(input) {
      const rows = await db
        .insert(schema.crawlRuns)
        .values({
          siteId: input.siteId,
          idempotencyKey: input.idempotencyKey,
          trigger: input.trigger,
          startUrl: input.configuration.startUrl,
          configSnapshot: { ...input.configuration },
        })
        .onConflictDoUpdate({
          target: schema.crawlRuns.idempotencyKey,
          set: { updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw new Error("Crawl run could not be created");
      return toRun(row);
    },
    async getRun(runId) {
      const rows = await db
        .select()
        .from(schema.crawlRuns)
        .where(eq(schema.crawlRuns.id, runId))
        .limit(1);
      return rows[0] === undefined ? null : toRun(rows[0]);
    },
    async getSiteScope(siteId) {
      const siteRows = await db
        .select({ canonicalOrigin: schema.sites.canonicalOrigin })
        .from(schema.sites)
        .where(
          and(eq(schema.sites.id, siteId), eq(schema.sites.status, "ACTIVE")),
        )
        .limit(1);
      const site = siteRows[0];
      if (site === undefined) return null;
      const hosts = await db
        .select({
          host: schema.siteHosts.host,
          includeSubdomains: schema.siteHosts.includeSubdomains,
        })
        .from(schema.siteHosts)
        .where(eq(schema.siteHosts.siteId, siteId));
      return { canonicalOrigin: site.canonicalOrigin, allowedHosts: hosts };
    },
    async markRunning(runId) {
      const rows = await db
        .update(schema.crawlRuns)
        .set({
          status: "RUNNING",
          startedAt: new Date(),
          updatedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        })
        .where(
          and(
            eq(schema.crawlRuns.id, runId),
            eq(schema.crawlRuns.status, "QUEUED"),
          ),
        )
        .returning({ id: schema.crawlRuns.id });
      if (rows.length === 1) return true;
      const current = await db
        .select({ status: schema.crawlRuns.status })
        .from(schema.crawlRuns)
        .where(eq(schema.crawlRuns.id, runId))
        .limit(1);
      return (
        current[0]?.status === "RUNNING" || current[0]?.status === "FAILED"
      );
    },
    async cancel(runId) {
      const rows = await db
        .update(schema.crawlRuns)
        .set({
          status: "CANCELLED",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.crawlRuns.id, runId),
            eq(schema.crawlRuns.status, "QUEUED"),
          ),
        )
        .returning({ id: schema.crawlRuns.id });
      if (rows.length === 1) return true;
      const running = await db
        .update(schema.crawlRuns)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(schema.crawlRuns.id, runId),
            eq(schema.crawlRuns.status, "RUNNING"),
          ),
        )
        .returning({ id: schema.crawlRuns.id });
      return running.length === 1;
    },
    async isCancelled(runId) {
      const rows = await db
        .select({ status: schema.crawlRuns.status })
        .from(schema.crawlRuns)
        .where(eq(schema.crawlRuns.id, runId))
        .limit(1);
      return rows[0]?.status === "CANCELLED";
    },
    async fail(runId, code, safeMessage) {
      await db
        .update(schema.crawlRuns)
        .set({
          status: "FAILED",
          errorCode: code,
          errorMessage: safeMessage,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.crawlRuns.id, runId));
    },
    async persistResult(runId, siteId, output) {
      await db.transaction(async (transaction) => {
        const pageIds = new Map<string, string>();
        const ensurePage = async (
          normalizedUrl: string,
          normalizedUrlHash?: string,
          normalizationVersion = URL_NORMALIZATION_VERSION,
        ): Promise<string> => {
          const hash =
            normalizedUrlHash ??
            createHash("sha256").update(normalizedUrl).digest("hex");
          const rows = await transaction
            .insert(schema.pages)
            .values({
              siteId,
              normalizedUrl,
              normalizedUrlHash: hash,
              normalizationVersion,
              lastObservedAt: output.finishedAt,
            })
            .onConflictDoUpdate({
              target: [schema.pages.siteId, schema.pages.normalizedUrlHash],
              set: {
                normalizedUrl,
                normalizationVersion,
                lastObservedAt: output.finishedAt,
              },
            })
            .returning({ id: schema.pages.id });
          const id = rows[0]?.id;
          if (id === undefined)
            throw new Error("Page identity could not be persisted");
          pageIds.set(normalizedUrl, id);
          return id;
        };

        for (const page of output.pages)
          await ensurePage(
            page.normalizedUrl,
            page.normalizedUrlHash,
            page.normalizationVersion,
          );
        for (const page of output.pages)
          for (const link of page.links)
            if (link.isInternal && !pageIds.has(link.normalizedUrl))
              await ensurePage(link.normalizedUrl);
        for (const sitemap of output.sitemaps)
          for (const entry of sitemap.entries)
            if (!pageIds.has(entry.url)) await ensurePage(entry.url);

        for (const page of output.pages) {
          const pageId = pageIds.get(page.normalizedUrl);
          if (pageId === undefined) continue;
          const values = {
            crawlRunId: runId,
            pageId,
            observedUrl: page.observedUrl,
            finalUrl: page.finalUrl,
            httpStatus: page.httpStatus,
            fetchStatus: page.fetchStatus,
            contentType: page.contentType,
            responseMs: page.responseMs,
            canonicalUrl: page.canonicalUrl,
            metaRobots: [...page.metaRobots],
            xRobotsTag: [...page.xRobotsTag],
            robotsAllowed: page.robotsAllowed,
            isIndexable: page.isIndexable,
            indexabilityReason: page.indexabilityReason,
            title: page.title,
            metaDescription: page.metaDescription,
            wordCount: page.wordCount,
            contentHash: page.contentHash,
            htmlHash: page.htmlHash,
            hasBreadcrumbs: page.hasBreadcrumbs,
            inSitemap: page.inSitemap,
            crawlDepth: page.depth,
            parserVersion: "cheerio-v1",
            errorCode: page.errorCode,
            errorMessage: page.errorMessage,
            fetchedAt: output.finishedAt,
          };
          const snapshots = await transaction
            .insert(schema.pageSnapshots)
            .values(values)
            .onConflictDoUpdate({
              target: [
                schema.pageSnapshots.crawlRunId,
                schema.pageSnapshots.pageId,
              ],
              set: values,
            })
            .returning({ id: schema.pageSnapshots.id });
          const snapshotId = snapshots[0]?.id;
          if (snapshotId === undefined)
            throw new Error("Page snapshot could not be persisted");
          if (page.redirectHops.length > 0)
            await transaction
              .insert(schema.redirectHops)
              .values(
                page.redirectHops.map((hop) => ({
                  pageSnapshotId: snapshotId,
                  ...hop,
                })),
              )
              .onConflictDoNothing();
          if (page.headings.length > 0)
            await transaction
              .insert(schema.headingObservations)
              .values(
                page.headings.map((heading) => ({
                  pageSnapshotId: snapshotId,
                  ...heading,
                })),
              )
              .onConflictDoNothing();
          if (page.schemaTypes.length > 0)
            await transaction
              .insert(schema.structuredDataObservations)
              .values(
                page.schemaTypes.map((schemaType) => ({
                  pageSnapshotId: snapshotId,
                  schemaType,
                })),
              )
              .onConflictDoNothing();
          if (page.images.length > 0)
            await transaction
              .insert(schema.imageObservations)
              .values(
                page.images.map((image, position) => ({
                  pageSnapshotId: snapshotId,
                  position,
                  ...image,
                })),
              )
              .onConflictDoNothing();
          for (const [position, link] of page.links.entries()) {
            const occurrenceKey = createHash("sha256")
              .update(
                `${page.normalizedUrl}\n${link.normalizedUrl}\n${link.anchorText ?? ""}\n${link.rel ?? ""}\n${position}`,
              )
              .digest("hex");
            await transaction
              .insert(schema.linkEdges)
              .values({
                crawlRunId: runId,
                sourcePageId: pageId,
                targetPageId: link.isInternal
                  ? (pageIds.get(link.normalizedUrl) ?? null)
                  : null,
                targetUrl: link.normalizedUrl,
                isInternal: link.isInternal,
                anchorText: link.anchorText,
                rel: link.rel,
                occurrenceKey,
              })
              .onConflictDoNothing();
          }
        }

        const robotsValues = {
          httpStatus: output.robots.status,
          contentHash: output.robots.contentHash,
          sitemaps: [...output.robots.sitemaps],
          crawlDelaySeconds:
            output.robots.crawlDelaySeconds === null
              ? null
              : Math.ceil(output.robots.crawlDelaySeconds),
          errorCode: output.robots.errorCode,
          errorMessage: output.robots.errorMessage,
          fetchedAt: output.robots.fetchedAt,
        };
        await transaction
          .insert(schema.robotsObservations)
          .values({
            crawlRunId: runId,
            url: output.robots.url,
            ...robotsValues,
          })
          .onConflictDoUpdate({
            target: schema.robotsObservations.crawlRunId,
            set: robotsValues,
          });
        for (const sitemap of output.sitemaps) {
          const sitemapValues = {
            parentUrl: sitemap.parentUrl,
            httpStatus: sitemap.status,
            contentHash: sitemap.contentHash,
            documentType: sitemap.documentType,
            errorCode: sitemap.errorCode,
            errorMessage: sitemap.errorMessage,
          };
          const fetchRows = await transaction
            .insert(schema.sitemapFetches)
            .values({ crawlRunId: runId, url: sitemap.url, ...sitemapValues })
            .onConflictDoUpdate({
              target: [
                schema.sitemapFetches.crawlRunId,
                schema.sitemapFetches.url,
              ],
              set: sitemapValues,
            })
            .returning({ id: schema.sitemapFetches.id });
          const sitemapFetchId = fetchRows[0]?.id;
          if (sitemapFetchId !== undefined && sitemap.entries.length > 0)
            await transaction
              .insert(schema.sitemapEntries)
              .values(
                sitemap.entries.map((entry) => ({
                  crawlRunId: runId,
                  sitemapFetchId,
                  normalizedUrl: entry.url,
                  pageId: pageIds.get(entry.url) ?? null,
                  lastModified: entry.lastModified,
                })),
              )
              .onConflictDoNothing();
        }

        const analysisRows = await transaction
          .insert(schema.analysisRuns)
          .values({
            crawlRunId: runId,
            rulesetVersion: TECHNICAL_RULESET_VERSION,
            status: "RUNNING",
          })
          .onConflictDoUpdate({
            target: [
              schema.analysisRuns.crawlRunId,
              schema.analysisRuns.rulesetVersion,
            ],
            set: { status: "RUNNING", finishedAt: null },
          })
          .returning({ id: schema.analysisRuns.id });
        const analysisRunId = analysisRows[0]?.id;
        if (analysisRunId === undefined)
          throw new Error("Analysis run could not be persisted");
        for (const item of output.issues) {
          const definitions = await transaction
            .insert(schema.issueDefinitions)
            .values({
              code: item.code,
              ruleVersion: item.ruleVersion,
              severity: item.severity,
              remediation: item.remediation,
            })
            .onConflictDoUpdate({
              target: [
                schema.issueDefinitions.code,
                schema.issueDefinitions.ruleVersion,
              ],
              set: { severity: item.severity, remediation: item.remediation },
            })
            .returning({ id: schema.issueDefinitions.id });
          const definitionId = definitions[0]?.id;
          if (definitionId !== undefined)
            await transaction
              .insert(schema.issueOccurrences)
              .values({
                analysisRunId,
                issueDefinitionId: definitionId,
                pageId:
                  item.pageUrl === null
                    ? null
                    : (pageIds.get(item.pageUrl) ?? null),
                fingerprint: item.fingerprint,
                evidence: item.evidence,
                detectedAt: output.finishedAt,
              })
              .onConflictDoNothing();
        }
        for (const metric of output.pageMetrics) {
          const pageId = pageIds.get(metric.pageUrl);
          if (pageId !== undefined)
            await transaction
              .insert(schema.pageMetrics)
              .values({
                crawlRunId: runId,
                pageId,
                crawlDepth: metric.crawlDepth,
                incomingInternalLinks: metric.incomingInternalLinks,
                outgoingInternalLinks: metric.outgoingInternalLinks,
                isOrphan: metric.isOrphan,
              })
              .onConflictDoUpdate({
                target: [
                  schema.pageMetrics.crawlRunId,
                  schema.pageMetrics.pageId,
                ],
                set: {
                  crawlDepth: metric.crawlDepth,
                  incomingInternalLinks: metric.incomingInternalLinks,
                  outgoingInternalLinks: metric.outgoingInternalLinks,
                  isOrphan: metric.isOrphan,
                },
              });
        }
        await transaction
          .update(schema.analysisRuns)
          .set({ status: "SUCCEEDED", finishedAt: output.finishedAt })
          .where(eq(schema.analysisRuns.id, analysisRunId));
        const runStatus = await transaction
          .select({ status: schema.crawlRuns.status })
          .from(schema.crawlRuns)
          .where(eq(schema.crawlRuns.id, runId))
          .limit(1);
        await transaction
          .update(schema.crawlRuns)
          .set({
            status:
              runStatus[0]?.status === "CANCELLED" ? "CANCELLED" : "SUCCEEDED",
            summary: output.summary,
            finishedAt: output.finishedAt,
            updatedAt: output.finishedAt,
          })
          .where(eq(schema.crawlRuns.id, runId));
      });
    },
  };
}
