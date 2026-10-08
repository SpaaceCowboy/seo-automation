import { loadEnvironment } from "@roco/config";

loadEnvironment();
try {
  const key = process.env.LLM_OPENAI_API_KEY;
  const model = process.argv[2];
  if (!key || !model || !/^[a-zA-Z0-9_.-]{1,100}$/.test(model))
    throw new Error("MODEL_AND_PROJECT_KEY_REQUIRED");
  const response = await fetch(`https://api.openai.com/v1/models/${model}`, {
    headers: { authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  await response.body?.cancel();
  process.stdout.write(
    JSON.stringify({
      model,
      httpStatus: response.status,
      authenticatedModelAccess: response.ok,
      inferenceRequested: false,
    }) + "\n",
  );
  if (!response.ok) process.exitCode = 1;
} catch {
  process.stderr.write(
    "AI connection check failed; check worker credential and model access.\n",
  );
  process.exitCode = 1;
}
