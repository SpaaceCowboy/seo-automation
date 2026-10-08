import { loadEnvironment } from "@roco/config";
import { createDatabase } from "@roco/db";
loadEnvironment();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = createDatabase(process.env.DATABASE_URL, {
  application_name: "roco-operations",
  statement_timeout: 5000,
});
try {
  await db.pool.query("begin read only");
  const report: Record<string, unknown> = {};
  for (const table of [
    "crawl_runs",
    "integration_sync_runs",
    "opportunity_runs",
    "agent_runs",
    "measurement_runs",
  ])
    report[table] = (
      await db.pool.query(
        `select id, site_id, status, created_at, finished_at from ${table} order by created_at desc limit 10`,
      )
    ).rows;
  report.queue = (
    await db.pool.query(
      "select name,state,count(*)::int as jobs from pgboss.job group by name,state order by name,state",
    )
  ).rows;
  report.schedules = (
    await db.pool.query(
      "select name,key,cron from pgboss.schedule order by name,key",
    )
  ).rows;
  report.futureMeasurements = (
    await db.pool.query(
      "select horizon,count(*)::int as plans,min(ready_at) as next_ready from measurement_plans where completed_at is null group by horizon order by horizon",
    )
  ).rows;
  for (const table of [
    "gsc_page_daily",
    "gsc_query_daily",
    "gsc_page_query_daily",
    "ga4_page_daily",
  ])
    report[table] = (
      await db.pool.query(
        `select site_id,count(*)::int as records,min(date) as first_date,max(date) as latest_date${table === "gsc_query_daily" ? "" : ",count(*) filter(where page_id is null)::int as unmapped"} from ${table} group by site_id`,
      )
    ).rows;
  report.mappingFailures = (
    await db.pool.query(
      "select provider,reason,count(*)::int as records from integration_unmatched_urls group by provider,reason",
    )
  ).rows;
  await db.pool.query("commit");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch {
  await db.pool.query("rollback");
  process.stderr.write(
    "Operational inspection failed; check schema version and database/queue readiness.",
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
