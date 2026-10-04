import { z } from "zod";

import { createFoundationJobRepository, type FoundationJobRepository } from "@roco/db";
import type { Logger } from "@roco/shared";
import type { Job } from "pg-boss";

export const FOUNDATION_NOOP_QUEUE = "foundation.noop";

const noopJobDataSchema = z.object({
    correlationId: z.string().min(1).max(128).optional(),
    idempotencyKey: z.string().min(1).max(256).optional(),
})

export interface FoundtionNoopHandlerDependencies{
    readonly logger: Logger;
    readonly repository: FoundationJobRepository;
}

export function createFoundationNoopHandler(
    dependencies: FoundtionNoopHandlerDependencies,
): (jobs: Job<unknown>[]) => Promise<void> {
    return async (claimedJobs) => {
        for (const job of claimedJobs) {
            const data = noopJobDataSchema.parse(job.data);
            const idempotencyKey = data.idempotencyKey ?? `${FOUNDATION_NOOP_QUEUE}:${job.id}`;
            const correlationId = data.correlationId ?? job.id;
            const claimed = await dependencies.repository.claim({
                jobType: FOUNDATION_NOOP_QUEUE,
                idempotencyKey,
                correlationId,
                payload: data,
            });

            if (!claimed) {
                dependencies.logger.info(
                    { jobId: job.id, idempotencyKey, correlationId},
                    "duplicate founcation job ignored"
                );
                continue
            }

            try {
                dependencies.logger.info(
                    { jobId: job.id, idempotencyKey, correlationId },
                    "foundation heath job complete"
                );
                await dependencies.repository.succeed(idempotencyKey);
            } catch (error) {
                await dependencies.repository.fail(
                    idempotencyKey,
                    "FOUNDATION_NOOP_FAILED",
                    "the foundation health job failed",
                );
                throw error
            }
        }
    }
}