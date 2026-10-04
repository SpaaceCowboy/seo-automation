import { loadEnvironment, parseWorkerConfig } from "@roco/config";
import { createLogger } from "@roco/shared";

import { createWorkerRuntime } from "./runtime.js";

const bootstrapLogger = createLogger({
    service: "roco-seo-worker",
    environment: process.env.NODE_ENV ?? "development",
    level: "info",
})

async function start(): Promise<void> {
    loadEnvironment();
    const config = parseWorkerConfig();
    const logger = createLogger({
        service: "roco-seo-worker",
        environment: config.NODE_ENV,
        level: config.LOG_LEVEL,
    });
    const runtime = createWorkerRuntime(config, logger);
    let shuttingDown = false;

    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, " worker recived shutdown signal");
        await runtime.stop();
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));

    await runtime.start();
}

try {
    await start();
} catch (error) {
    bootstrapLogger.fatal({err: error}, "worker failed to start");
    process.exitCode = 1
}