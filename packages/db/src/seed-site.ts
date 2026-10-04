import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { eq } from "drizzle-orm";

import { createDatabase } from "./index.js";
import { siteHosts, sites } from "./schema.js";

loadDotenv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const [name, originInput, timezone] = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
if (name === undefined || originInput === undefined || timezone === undefined) {
  throw new Error(
    'Usage: pnpm site:upsert -- "Site name" "https://example.com" "Area/City"',
  );
}
const originUrl = new URL(originInput);
if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")
  throw new Error("Site origin must use HTTP or HTTPS");
const canonicalOrigin = originUrl.origin;
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");

const database = createDatabase(databaseUrl, {
  application_name: "roco-seo-site-upsert",
});
try {
  const rows = await database.db
    .insert(sites)
    .values({ name, canonicalOrigin, timezone })
    .onConflictDoUpdate({
      target: sites.canonicalOrigin,
      set: { name, timezone, status: "ACTIVE", updatedAt: new Date() },
    })
    .returning({ id: sites.id });
  const siteId = rows[0]?.id;
  if (siteId === undefined) throw new Error("Site could not be registered");
  await database.db
    .insert(siteHosts)
    .values({ siteId, host: originUrl.hostname.toLowerCase() })
    .onConflictDoNothing();
  const site = await database.db
    .select()
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  process.stdout.write(`${JSON.stringify(site[0])}\n`);
} finally {
  await database.close();
}
