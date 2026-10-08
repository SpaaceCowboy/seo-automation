import { readFile, writeFile } from "node:fs/promises";
import { loadEnvironment } from "@roco/config";
loadEnvironment();
try {
  const [kind, method, path, bodyFile, outputFile] = process.argv.slice(2);
  if (
    !["workflow", "opportunities", "agents"].includes(kind ?? "") ||
    !["GET", "POST", "PATCH"].includes(method ?? "") ||
    !path?.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("..")
  )
    throw new Error(
      "Usage: api-command workflow|opportunities|agents GET|POST|PATCH /path [body-file|-] [private-output-file]",
    );
  const access = process.env.WORKFLOW_ACCESS_JSON
    ? (JSON.parse(process.env.WORKFLOW_ACCESS_JSON) as { token: string }[])
    : [];
  const token =
    kind === "opportunities"
      ? process.env.OPPORTUNITY_API_TOKEN
      : kind === "agents"
        ? process.env.AGENT_API_TOKEN
        : access[0]?.token;
  if (!token)
    throw new Error("The selected operation credential is not configured");
  const body =
    bodyFile && bodyFile !== "-" ? await readFile(bodyFile, "utf8") : undefined;
  const response = await fetch(
    `${process.env.ROCO_API_URL ?? "http://127.0.0.1:4000"}${path}`,
    {
      method: method!,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  const data: unknown = response.status === 204 ? {} : await response.json();
  if (outputFile)
    await writeFile(outputFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  const safe =
    typeof data === "object" && data !== null
      ? Object.fromEntries(
          Object.entries(data).filter(([key]) =>
            [
              "id",
              "status",
              "error",
              "requestId",
              "summary",
              "statistics",
            ].includes(key),
          ),
        )
      : {};
  process.stdout.write(
    JSON.stringify({ httpStatus: response.status, ...safe }) + "\n",
  );
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    error instanceof Error && error.message.startsWith("Usage:")
      ? error.message
      : "Operational API request failed; inspect safe service logs and configuration.",
  );
  process.exitCode = 1;
}
