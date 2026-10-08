import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvironment } from "../../packages/config/src/index.js";
import {
  createDatabase,
  createOpportunityRepository,
} from "../../packages/db/src/index.js";
import {
  configSchema,
  detectOpportunities,
  safeEndDate,
} from "../../packages/opportunities/src/index.js";
loadEnvironment();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write(
    "DATABASE_URL is not configured. Existing Phase 2/3 data cannot be validated from this checkout.\n",
  );
  process.exitCode = 1;
} else {
  const db = createDatabase(databaseUrl);
  try {
    const sites = await db.pool.query<{ id: string; name: string }>(
      "select id,name from sites where status='ACTIVE' order by id",
    );
    const reports = [];
    for (const site of sites.rows) {
      const repository = createOpportunityRepository(db.db);
      const config = configSchema.parse({});
      const input = await repository.previewInput(
        site.id,
        safeEndDate(new Date(), config.lagDays),
        config,
      );
      const result = detectOpportunities(input, config);
      reports.push({
        siteId: site.id,
        siteName: site.name,
        sourceCounts: {
          pages: input.pageMetrics.length,
          pageQuery: input.pageQueryMetrics.length,
          crawlPages: input.crawl?.pages.length ?? 0,
          ga4: input.ga4.length,
          pageSpeed: input.pageSpeed.length,
        },
        totalOpportunities: result.candidates.length,
        statistics: result.statistics,
        topOpportunities: result.candidates.slice(0, 10),
      });
    }
    const output = {
      validatedAt: new Date().toISOString(),
      sites: reports,
      warning: reports.length
        ? null
        : "No registered active sites; no production observations were available.",
    };
    await mkdir(new URL("../../tmp/", import.meta.url), { recursive: true });
    await writeFile(
      new URL("../../tmp/phase4-validation.json", import.meta.url),
      JSON.stringify(output, null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(
      JSON.stringify(
        {
          sites: reports.map((r) => ({
            siteId: r.siteId,
            totalOpportunities: r.totalOpportunities,
            counts: r.statistics.counts,
            insufficient: r.statistics.insufficient,
          })),
          report: "tmp/phase4-validation.json",
          warning: output.warning,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await db.close();
  }
}
