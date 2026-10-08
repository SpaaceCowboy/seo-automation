import { readFile } from "node:fs/promises";
try {
  const service = process.argv[2];
  if (service === "worker") {
    const health = JSON.parse(
      await readFile(
        process.env.WORKER_HEALTH_FILE ?? "/tmp/roco-worker-health.json",
        "utf8",
      ),
    ) as { database: boolean; queue: boolean; timestamp: number };
    if (
      !health.database ||
      !health.queue ||
      !Number.isFinite(health.timestamp) ||
      health.timestamp > Date.now() + 1000 ||
      Date.now() - health.timestamp > 45000
    )
      throw new Error("UNHEALTHY");
  } else {
    const url =
      service === "api"
        ? "http://127.0.0.1:4000/ready"
        : "http://127.0.0.1:3000/sign-in";
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    if (response.status !== 200) throw new Error("UNHEALTHY");
  }
} catch {
  process.exitCode = 1;
}
