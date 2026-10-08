import { describe, it, expect, vi } from "vitest";
import {
  checkOpenaiAccess,
  integrationSnapshot,
  createOpenaiCheckHandler,
} from "../src/jobs/check-openai.js";
import { parseWorkerConfig } from "@roco/config";
import { createLogger } from "@roco/shared";
import type { IntegrationStatusRepository } from "@roco/db";
import type { Job } from "pg-boss";
const logger = createLogger({
  service: "check-test",
  environment: "test",
  level: "silent",
});
describe("token-free model access checks", () => {
  it("uses only the fixed metadata endpoint, cancels bodies and never requests inference", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      expect(url).toBe("https://api.openai.com/v1/models/fixture-model");
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.method).toBeUndefined();
      expect(options?.body).toBeUndefined();
      return Response.json({
        id: "fixture-model",
        object: "model",
        owned_by: "provider body must not be stored",
      });
    });
    expect(
      await checkOpenaiAccess("credential-secret", "fixture-model", fetcher),
    ).toMatchObject({ status: "VERIFIED", errorCode: null, httpStatus: 200 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects silent success with malformed, mismatched or oversized metadata", async () => {
    for (const body of [
      "not JSON",
      JSON.stringify({ id: "other-model", object: "model" }),
      "x".repeat(65537),
    ]) {
      const result = await checkOpenaiAccess(
        "key",
        "fixture-model",
        async () => new Response(body),
      );
      expect(result).toMatchObject({
        status: "FAILED",
        errorCode: "OPENAI_INVALID_MODEL_RESPONSE",
        httpStatus: 200,
      });
    }
  });
  it.each([
    [401, "OPENAI_CREDENTIAL_REJECTED"],
    [403, "OPENAI_ACCESS_DENIED"],
    [404, "OPENAI_MODEL_UNAVAILABLE"],
    [429, "OPENAI_RATE_LIMITED"],
    [503, "OPENAI_PROVIDER_UNAVAILABLE"],
  ])(
    "classifies %s without retaining provider content or retrying",
    async (status, code) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response("secret-error-body", { status: Number(status) }),
      );
      const result = await checkOpenaiAccess("key", "model", fetcher);
      expect(result).toMatchObject({ status: "FAILED", errorCode: code });
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("classifies timeout and network errors safely and rejects arbitrary URLs before egress", async () => {
    expect(
      await checkOpenaiAccess("key", "model", async () => {
        throw new DOMException("secret", "TimeoutError");
      }),
    ).toMatchObject({ errorCode: "OPENAI_CHECK_TIMEOUT" });
    expect(
      await checkOpenaiAccess("key", "model", async () => {
        throw new Error("secret");
      }),
    ).toMatchObject({ errorCode: "OPENAI_CHECK_NETWORK_ERROR" });
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await checkOpenaiAccess("key", "https://other.test", fetcher),
    ).toMatchObject({ errorCode: "OPENAI_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("publishes no keys or credential paths", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://example/test",
      LLM_OPENAI_API_KEY: "never-store-key",
      GOOGLE_CREDENTIALS_FILE: "/private/key.json",
    });
    const snapshot = integrationSnapshot(config, null);
    expect(JSON.stringify(snapshot)).not.toContain("never-store-key");
    expect(JSON.stringify(snapshot)).not.toContain("/private");
    expect(snapshot.agents.every((a) => !a.enabled)).toBe(true);
  });
  it("skips superseded boot jobs without a provider call", async () => {
    const fetcher = vi.fn<typeof fetch>(),
      claim = vi.fn();
    const repository = { claim } as unknown as IntegrationStatusRepository;
    await createOpenaiCheckHandler({
      repository,
      instanceId: "11111111-1111-4111-8111-111111111111",
      key: "key",
      logger,
      fetcher,
    })([
      {
        id: "job",
        data: {
          checkId: "22222222-2222-4222-8222-222222222222",
          instanceId: "33333333-3333-4333-8333-333333333333",
          correlationId: "test",
        },
      } as Job<unknown>,
    ]);
    expect(claim).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
