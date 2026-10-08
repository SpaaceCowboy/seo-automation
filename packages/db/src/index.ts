import { fileURLToPath } from "node:url";

import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

import { jobs } from "./schema.js";
import * as schema from "./schema.js";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<QueryResult<R>>;
}

export interface DatabaseClient {
  readonly db: NodePgDatabase<typeof schema>;
  readonly pool: Pool;
  close(): Promise<void>;
  isQueueReady(): Promise<boolean>;
  ping(): Promise<boolean>;
}

export function createDatabase(
  databaseUrl: string,
  overrides: PoolConfig = {},
): DatabaseClient {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "roco-seo",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    ...overrides,
  });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async ping() {
      return probeDatabase(pool);
    },
    async isQueueReady() {
      return probeQueueSchema(pool);
    },
    async close() {
      await pool.end();
    },
  };
}

export async function probeDatabase(queryable: Queryable): Promise<boolean> {
  try {
    await queryable.query("select 1");
    return true;
  } catch {
    return false;
  }
}

export async function probeQueueSchema(queryable: Queryable): Promise<boolean> {
  try {
    const result = await queryable.query<{ ready: boolean }>(
      "select to_regclass('pgboss.version') is not null as ready",
    );
    return result.rows[0]?.ready === true;
  } catch {
    return false;
  }
}

export async function migrateDatabase(pool: Pool): Promise<void> {
  const migrationsFolder = fileURLToPath(
    new URL("../migrations", import.meta.url),
  );
  await migrate(drizzle(pool), { migrationsFolder });
}

export interface FoundationJobClaim {
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly jobType: string;
  readonly payload: Record<string, unknown>;
}

export interface FoundationJobRepository {
  claim(input: FoundationJobClaim): Promise<boolean>;
  fail(
    idempotencyKey: string,
    code: string,
    safeMessage: string,
  ): Promise<void>;
  succeed(idempotencyKey: string): Promise<void>;
}

export function createFoundationJobRepository(
  db: NodePgDatabase<typeof schema>,
): FoundationJobRepository {
  return {
    async claim(input) {
      const inserted = await db
        .insert(jobs)
        .values({
          jobType: input.jobType,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          payload: input.payload,
          status: "RUNNING",
          startedAt: new Date(),
          attemptCount: 1,
        })
        .onConflictDoNothing({ target: jobs.idempotencyKey })
        .returning({ id: jobs.id });
      return inserted.length === 1;
    },
    async succeed(idempotencyKey) {
      await db
        .update(jobs)
        .set({
          status: "SUCCEEDED",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(jobs.idempotencyKey, idempotencyKey),
            eq(jobs.status, "RUNNING"),
          ),
        );
    },
    async fail(idempotencyKey, code, safeMessage) {
      await db
        .update(jobs)
        .set({
          status: "FAILED",
          errorCode: code,
          errorMessage: safeMessage,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(jobs.idempotencyKey, idempotencyKey),
            eq(jobs.status, "RUNNING"),
          ),
        );
    },
  };
}

export * from "./schema.js";
export * from "./crawl-repository.js";
export * from "./integration-repository.js";
export * from "./opportunity-repository.js";
export * from "./agent-repository.js";
export * from "./workflow-repository.js";
export * from "./measurement-repository.js";

export * from "./control-repository.js";
