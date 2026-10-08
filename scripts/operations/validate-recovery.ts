import { spawnSync } from "node:child_process";
import { loadEnvironment } from "@roco/config";
import { createDatabase } from "@roco/db";

loadEnvironment();
const target = process.argv[2];
if (!target || !/^roco_restore_[a-z0-9_]+$/.test(target))
  throw new Error("Validation requires an isolated roco_restore_ database");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const connection = new URL(process.env.DATABASE_URL);
connection.pathname = "/" + target;
const database = createDatabase(connection.toString());
try {
  // Remove copied work ONLY from the disposable restore database before registering handlers.
  await database.pool.query("delete from pgboss.job");
} finally {
  await database.close();
}
for (const file of [
  "tests/integration/workflow.integration.test.ts",
  "tests/integration/reliability.integration.test.ts",
]) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", file],
    {
      cwd: "/app",
      env: {
        ...process.env,
        NODE_ENV: "test",
        XDG_DATA_HOME: "/tmp/roco-vitest-data",
        XDG_CACHE_HOME: "/tmp/roco-vitest-cache",
        TEST_DATABASE_URL: connection.toString(),
        GOOGLE_SCHEDULES_ENABLED: "false",
        AGENTS_ENABLED: "false",
      },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const check = createDatabase(connection.toString());
try {
  const plans = await check.pool.query(
    "select horizon,count(*)::int as plans from measurement_plans group by horizon order by horizon",
  );
  process.stdout.write(
    JSON.stringify({ isolatedDatabase: target, plans: plans.rows }) + "\n",
  );
} finally {
  await check.close();
}
