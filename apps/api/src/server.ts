import { parseApiConfig, loadEnvironment } from "@roco/config";
import { createDatabase } from "@roco/db";
import { createLogger } from "@roco/shared";

import { buildApp } from "./app.js";

const bootstrapLogger = createLogger({
    service: "roco-seo-api",
    enviroment: process.env.NODE_ENV ?? "development",
    level: "info",
})

async function start(): Promise<void> {
    loadEnvironment();
    const config = parseApiConfig();
    const logger = createLogger({
        service: "roco-seo-api",
        environment: config.NODE_ENV,
        level: config.LOG_LEVEL,
    });
    const database = createDatabase(config.DATABASE_URL, {
        application_name: "roco-seo-api"
    });
    const app = buildApp({
        logger,
        async readiness() {
            const [databaseReady, queueReady] = await Promise.all([
                database.ping(),
                database.isQueueReady(),
            ]);
            return {database: databaseReady, queue: queueReady};
        },
    })

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        logger.info({signal}, "API shurdown started");
        await app.close();
        await database.close();
        logger.info("API shutdown completed");
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));

    await app.listen({ host: config.API_HOST, port: config.API_PORT});
    logger.info({ host: config.API_HOST, port: config.API_PORT})
}

try { 
    await start();
} catch (error) {
    bootstrapLogger.fatal({ err: error}, "API failed to start");
    process.exitCode = 1;
}