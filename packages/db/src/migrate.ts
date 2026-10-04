import { createDatabase, migrateDatabase } from "./index.js";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

loadDotenv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const database = createDatabase(databaseUrl, {
  application_name: "roco-seo-migrations",
});

try {
  await migrateDatabase(database.pool);
} finally {
  await database.close();
}
