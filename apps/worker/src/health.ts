import { writeFile, rename, rm } from "node:fs/promises";
import type { DatabaseClient } from "@roco/db";
import type { Logger } from "@roco/shared";

export function startWorkerHealth(
  path: string,
  database: DatabaseClient,
  logger: Logger,
  publish?: (healthy: boolean) => Promise<void>,
) {
  let busy = false,
    stopped = false;
  const check = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const [db, queue] = await Promise.all([
        database.ping(),
        database.isQueueReady(),
      ]);
      if (stopped) return;
      await writeFile(
        path + ".tmp",
        JSON.stringify({ timestamp: Date.now(), database: db, queue }),
        { mode: 0o600 },
      );
      await rename(path + ".tmp", path);
      try {
        await publish?.(db && queue);
      } catch {
        logger.error(
          { errorCode: "WORKER_TELEMETRY_FAILED" },
          "worker telemetry publication failed",
        );
      }
      if (!db || !queue)
        logger.error(
          { errorCode: "WORKER_DEPENDENCY_UNAVAILABLE" },
          "worker health failed",
        );
    } catch {
      logger.error(
        { errorCode: "WORKER_HEALTH_FAILED" },
        "worker heartbeat failed",
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void check(), 15000);
  timer.unref();
  void check();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await rm(path, { force: true });
  };
}
