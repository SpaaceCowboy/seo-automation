import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  agentCodeSchema,
  runtimeSnapshotSchema,
  integrationsStatusSchema,
  type RuntimeSnapshot,
  type IntegrationsStatus,
} from "@roco/shared/control";
import { requireRole, WorkflowError, type Principal } from "@roco/workflow";

interface RuntimeRow {
  instance_id: string;
  snapshot: unknown;
  last_seen: Date;
  healthy: boolean;
}
interface CheckRow {
  id: string;
  instance_id: string;
  model: string;
  status: string;
  requested_at: Date;
  finished_at: Date | null;
  error_code: string | null;
  http_status: number | null;
  duration_ms: number | null;
  correlation_id: string;
}
export interface CheckTicket {
  id: string;
  instanceId: string;
  correlationId: string;
  status: string;
  enqueue: boolean;
}
export interface CheckResult {
  status: "VERIFIED" | "FAILED";
  errorCode: string | null;
  httpStatus: number | null;
  durationMs: number;
}
export function createIntegrationStatusRepository(
  pool: Pool,
  clock = () => new Date(),
) {
  async function transaction<T>(
    work: (client: PoolClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? "begin read only" : "begin");
      await client.query("set local statement_timeout='5s'");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  const runtime = async (client: PoolClient) =>
    (
      await client.query<RuntimeRow>(
        "select instance_id,snapshot,last_seen,healthy from integration_runtime where name='worker'",
      )
    ).rows[0];
  async function reconcile(client: PoolClient, instanceId: string, now: Date) {
    await client.query(
      "update integration_connection_checks set status='SUPERSEDED',finished_at=$2,error_code='CHECK_INTERRUPTED' where status in ('QUEUED','RUNNING') and (instance_id<>$1 or requested_at<$2::timestamptz-interval '60 seconds')",
      [instanceId, now],
    );
  }
  async function auditManual(
    client: PoolClient,
    p: Principal | undefined,
    id: string,
    coalesced: boolean,
  ) {
    if (p)
      await client.query(
        "insert into audit_events(actor_id,action,subject_type,subject_id,correlation_id,metadata) values($1,'INTEGRATION_CHECK_REQUESTED','integration_check',$2,$3,$4)",
        [p.actorId, id, p.correlationId, JSON.stringify({ coalesced })],
      );
  }
  return {
    async publish(instanceId: string, snapshot: RuntimeSnapshot) {
      const safe = runtimeSnapshotSchema.parse(snapshot);
      await transaction(async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtext('integration-check'))",
        );
        await client.query(
          "insert into integration_runtime(name,instance_id,snapshot,last_seen,healthy) values('worker',$1,$2,$3,true) on conflict(name) do update set instance_id=excluded.instance_id,snapshot=excluded.snapshot,last_seen=excluded.last_seen,healthy=true",
          [instanceId, JSON.stringify(safe), clock()],
        );
        await reconcile(client, instanceId, clock());
      });
    },
    async heartbeat(instanceId: string, healthy: boolean) {
      await pool.query(
        "update integration_runtime set last_seen=$2,healthy=$3 where name='worker' and instance_id=$1",
        [instanceId, clock(), healthy],
      );
    },
    async stop(instanceId: string) {
      await pool.query(
        "update integration_runtime set healthy=false where name='worker' and instance_id=$1",
        [instanceId],
      );
    },
    async request(
      trigger: "STARTUP" | "SCHEDULED" | "MANUAL",
      p?: Principal,
    ): Promise<CheckTicket> {
      if (trigger === "MANUAL") {
        if (!p) throw new WorkflowError("UNAUTHORIZED");
        requireRole(p, "OPERATOR");
      }
      return transaction(async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtext('integration-check'))",
        );
        if (
          trigger === "MANUAL" &&
          !(
            await client.query(
              "select id from actors where id=$1 and type='HUMAN' and disabled_at is null",
              [p!.actorId],
            )
          ).rowCount
        )
          throw new WorkflowError("HUMAN_ACTOR_REQUIRED");
        const row = await runtime(client),
          now = clock();
        if (
          !row ||
          !row.healthy ||
          now.getTime() - row.last_seen.getTime() > 45000
        )
          throw new WorkflowError("INTEGRATION_WORKER_UNAVAILABLE");
        const snapshot = runtimeSnapshotSchema.parse(row.snapshot);
        if (!snapshot.openai.keyConfigured || !snapshot.openai.model)
          throw new WorkflowError("OPENAI_NOT_CONFIGURED");
        await reconcile(client, row.instance_id, now);
        const recent = (
          await client.query<CheckRow>(
            "select * from integration_connection_checks where instance_id=$1 and model=$2 order by requested_at desc,id desc limit 1",
            [row.instance_id, snapshot.openai.model],
          )
        ).rows[0];
        if (recent && now.getTime() - recent.requested_at.getTime() < 60000) {
          await auditManual(client, p, recent.id, true);
          return {
            id: recent.id,
            instanceId: row.instance_id,
            correlationId: recent.correlation_id,
            status: recent.status,
            enqueue: false,
          };
        }
        const id = randomUUID(),
          correlationId = p?.correlationId ?? randomUUID();
        await client.query(
          "insert into integration_connection_checks(id,instance_id,model,trigger,actor_id,correlation_id,status,requested_at) values($1,$2,$3,$4,$5,$6,'QUEUED',$7)",
          [
            id,
            row.instance_id,
            snapshot.openai.model,
            trigger,
            p?.actorId ?? null,
            correlationId,
            now,
          ],
        );
        await auditManual(client, p, id, false);
        return {
          id,
          instanceId: row.instance_id,
          correlationId,
          status: "QUEUED",
          enqueue: true,
        };
      });
    },
    async claim(id: string, instanceId: string) {
      return (
        (
          await pool.query<CheckRow>(
            "update integration_connection_checks c set status='RUNNING',started_at=$3 where c.id=$1 and c.instance_id=$2 and c.status='QUEUED' and c.requested_at>=$3::timestamptz-interval '60 seconds' and exists(select 1 from integration_runtime r where r.name='worker' and r.instance_id=c.instance_id and r.healthy) returning c.*",
            [id, instanceId, clock()],
          )
        ).rows[0] ?? null
      );
    },
    async finish(id: string, result: CheckResult) {
      await pool.query(
        "update integration_connection_checks c set status=case when exists(select 1 from integration_runtime r where r.name='worker' and r.instance_id=c.instance_id) then $2 else 'SUPERSEDED' end,finished_at=$3,error_code=$4,http_status=$5,duration_ms=$6 where c.id=$1 and c.status in ('QUEUED','RUNNING')",
        [
          id,
          result.status,
          clock(),
          result.errorCode,
          result.httpStatus,
          result.durationMs,
        ],
      );
    },
    async read(
      siteId: string | undefined,
      p: Principal,
    ): Promise<IntegrationsStatus> {
      requireRole(p, "READ");
      return transaction(async (client) => {
        const now = clock(),
          month = now.toISOString().slice(0, 7),
          row = await runtime(client);
        if (
          siteId &&
          !(await client.query("select id from sites where id=$1", [siteId]))
            .rowCount
        )
          throw new WorkflowError("CONTROL_RECORD_NOT_FOUND");
        const parsed = runtimeSnapshotSchema.safeParse(row?.snapshot),
          snapshot = parsed.success ? parsed.data : null;
        const state = !row
          ? "UNKNOWN"
          : now.getTime() - row.last_seen.getTime() > 45000
            ? "OFFLINE"
            : row.healthy
              ? "ONLINE"
              : "UNHEALTHY";
        const known = state === "ONLINE" && snapshot !== null;
        const latest =
          row && snapshot?.openai.model
            ? (
                await client.query<CheckRow>(
                  "select * from integration_connection_checks where instance_id=$1 and model=$2 order by requested_at desc,id desc limit 1",
                  [row.instance_id, snapshot.openai.model],
                )
              ).rows[0]
            : undefined;
        const configured = known
          ? !!snapshot.openai.keyConfigured && !!snapshot.openai.model
          : null;
        const age = latest
          ? now.getTime() - latest.requested_at.getTime()
          : Infinity;
        const pending =
          latest &&
          ["QUEUED", "RUNNING"].includes(latest.status) &&
          age < 60000;
        const connectionStatus = !known
          ? "STALE"
          : !configured
            ? "NOT_CONFIGURED"
            : !latest
              ? "NOT_CHECKED"
              : pending
                ? latest.status
                : !latest.finished_at ||
                    now.getTime() - latest.finished_at.getTime() > 1200000 ||
                    latest.status === "SUPERSEDED"
                  ? "STALE"
                  : latest.status;
        const ledger = (
          await client.query<{ limit_nanousd: string; booked_nanousd: string }>(
            "select limit_nanousd::text,booked_nanousd::text from agent_budget_months where month=$1",
            [month],
          )
        ).rows[0];
        const configuredLimit = known ? snapshot.limits.monthlyNanousd : null;
        const limit =
          configuredLimit === null
            ? null
            : ledger && BigInt(ledger.limit_nanousd) < BigInt(configuredLimit)
              ? ledger.limit_nanousd
              : configuredLimit;
        const booked = ledger?.booked_nanousd ?? "0",
          remaining =
            limit === null
              ? null
              : (BigInt(limit) > BigInt(booked)
                  ? BigInt(limit) - BigInt(booked)
                  : 0n
                ).toString();
        const attempts = siteId
          ? (
              await client.query<{
                provider: string;
                status: string;
                at: Date;
                error_code: string | null;
                dimension_set: string | null;
              }>(
                "select distinct on(provider) provider,status,coalesce(finished_at,created_at) as at,error_code,dimension_set from integration_sync_runs where site_id=$1 order by provider,created_at desc,id desc",
                [siteId],
              )
            ).rows
          : [];
        const successes = siteId
          ? (
              await client.query<{ provider: string; at: Date }>(
                "select provider,max(finished_at) as at from integration_sync_runs where site_id=$1 and status='SUCCEEDED' group by provider",
                [siteId],
              )
            ).rows
          : [];
        return integrationsStatusSchema.parse({
          observedAt: now.toISOString(),
          worker: { state, lastSeen: row?.last_seen.toISOString() ?? null },
          agents: agentCodeSchema.options.map((code) => {
            const agent = snapshot?.agents.find((a) => a.code === code);
            return {
              code,
              enabled:
                known && snapshot.policyKnown
                  ? (agent?.enabled ?? false)
                  : null,
              model: agent?.model ?? null,
              reasoning: agent?.reasoning ?? null,
            };
          }),
          openai: {
            configured,
            model: snapshot?.openai.model ?? null,
            status: row ? connectionStatus : "NOT_CHECKED",
            lastChecked: latest?.finished_at?.toISOString() ?? null,
            errorCode:
              latest?.error_code ??
              (latest && !pending && !latest.finished_at
                ? "CHECK_INTERRUPTED"
                : null),
            httpStatus: latest?.http_status ?? null,
            durationMs: latest?.duration_ms ?? null,
            checkId: latest?.id ?? null,
            canCheck:
              !!configured &&
              !pending &&
              age >= 60000 &&
              p.roles.includes("OPERATOR"),
            cooldownSeconds: Number.isFinite(age)
              ? Math.max(0, Math.ceil((60000 - age) / 1000))
              : 0,
          },
          budget: {
            month,
            limitNanousd: limit,
            bookedNanousd: booked,
            remainingNanousd: remaining,
            runNanousd: known ? snapshot.limits.runNanousd : null,
            minScore: known ? snapshot.limits.minScore : null,
          },
          google: (["GSC", "GA4", "PAGESPEED"] as const).map((provider) => {
            const attempt = attempts.find((a) => a.provider === provider),
              success = successes.find((a) => a.provider === provider);
            return {
              provider,
              configured: known ? snapshot.google[provider] : null,
              scheduledForSelectedSite:
                known && siteId && snapshot.google.siteId
                  ? snapshot.google.siteId === siteId
                  : null,
              latestAttempt: attempt
                ? {
                    status: attempt.status,
                    at: attempt.at.toISOString(),
                    errorCode: attempt.error_code,
                    dimensionSet: attempt.dimension_set,
                  }
                : null,
              lastSuccess: success?.at?.toISOString() ?? null,
            };
          }),
        });
      }, true);
    },
  };
}
export type IntegrationStatusRepository = ReturnType<
  typeof createIntegrationStatusRepository
>;
