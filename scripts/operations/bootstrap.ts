import { readFile } from "node:fs/promises";
import { loadEnvironment } from "@roco/config";
import { createDatabase } from "@roco/db";
loadEnvironment();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = createDatabase(process.env.DATABASE_URL);
try {
  const identities = JSON.parse(
    await readFile(process.argv[2] ?? "/operations/identities.json", "utf8"),
  ) as { id: string; type: string; name: string }[];
  await db.pool.query("begin");
  for (const actor of identities) {
    if (
      !/^[0-9a-f-]{36}$/i.test(actor.id) ||
      !["HUMAN", "SERVICE"].includes(actor.type) ||
      !actor.name?.trim()
    )
      throw new Error("INVALID_IDENTITY");
    await db.pool.query(
      "insert into actors(id,type,display_name) values($1,$2,$3) on conflict(id) do nothing",
      [actor.id, actor.type, actor.name],
    );
  }
  await db.pool.query("commit");
  process.stdout.write(
    "Initial named actors registered; credentials were not printed.",
  );
} catch {
  await db.pool.query("rollback");
  process.stderr.write(
    "Actor bootstrap failed; verify the private identities file and migrated database.",
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
