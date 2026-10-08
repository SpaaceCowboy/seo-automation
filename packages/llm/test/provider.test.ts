import { describe, expect, it, vi } from "vitest";
import {
  createFakeProvider,
  createOpenAiProvider,
  type GenerationRequest,
} from "../src/index.js";
const request: GenerationRequest & { schema: Record<string, unknown> } = {
  model: "pinned-model",
  system: "Rules",
  input: "Evidence",
  maxOutputTokens: 100,
  timeoutMs: 1000,
  schema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
const envelope = () => ({
  model: "pinned-model",
  choices: [{ finish_reason: "stop", message: { content: '{"valid":true}' } }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
});
describe("provider abstraction", () => {
  it("forwards explicit medium reasoning and the completion cap", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      if (typeof options?.body !== "string")
        throw new Error("Expected JSON body");
      const body = JSON.parse(options.body) as Record<string, unknown>;
      expect(body.reasoning_effort).toBe("medium");
      expect(body.max_completion_tokens).toBe(2048);
      expect(body.tools).toBeUndefined();
      return Response.json(envelope());
    });
    await createOpenAiProvider("fixture-key", fetcher).structuredGenerate({
      ...request,
      reasoningEffort: "medium",
      maxOutputTokens: 2048,
    });
  });
  it("supports both ports and provider substitution without live calls", async () => {
    const provider = createFakeProvider(
      () => ({
        text: "{}",
        providerRequestId: null,
        inputTokens: null,
        outputTokens: null,
      }),
      "alternative",
    );
    expect(provider.name).toBe("alternative");
    expect((await provider.generate(request)).text).toBe("{}");
    expect((await provider.structuredGenerate(request)).text).toBe("{}");
  });
  it("sends a bounded strict-schema request without tools or storage", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      expect(options?.redirect).toBe("error");
      if (typeof options?.body !== "string")
        throw new Error("Expected JSON request body.");
      const body = JSON.parse(options.body) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "pinned-model",
        store: false,
        service_tier: "default",
        max_completion_tokens: 100,
        response_format: { type: "json_schema", json_schema: { strict: true } },
      });
      expect(body.tools).toBeUndefined();
      return Response.json(envelope(), {
        headers: { "x-request-id": "request_abc" },
      });
    });
    const result = await createOpenAiProvider(
      "private-key",
      fetcher,
    ).structuredGenerate(request);
    expect(result).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      providerRequestId: "request_abc",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.any(Object),
    );
  });
  it("refuses a provider response reporting a different billing tier", async () => {
    const provider = createOpenAiProvider("fixture-key", async () =>
      Response.json({ ...envelope(), service_tier: "priority" }),
    );
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "PROVIDER_SERVICE_TIER_MISMATCH",
      retryable: false,
    });
  });
  it.each([429, 503, 401])(
    "classifies HTTP %i safely without echoing provider bodies",
    async (status) => {
      const provider = createOpenAiProvider(
        "key",
        async () => new Response("SECRET BODY", { status }),
      );
      await expect(provider.generate(request)).rejects.toMatchObject({
        code: "PROVIDER_HTTP_ERROR",
        retryable: status !== 401,
        status,
      });
    },
  );
  it("rejects refusal, truncation, tool calls, model drift and malformed envelopes", async () => {
    for (const [message, reason, code] of [
      [{ content: null, refusal: "No" }, "stop", "PROVIDER_REFUSAL"],
      [{ content: "{}" }, "length", "INCOMPLETE_PROVIDER_OUTPUT"],
      [{ content: "{}", tool_calls: [{}] }, "stop", "UNEXPECTED_TOOL_CALL"],
    ] as const) {
      const provider = createOpenAiProvider("key", async () =>
        Response.json({
          ...envelope(),
          choices: [{ finish_reason: reason, message }],
        }),
      );
      await expect(provider.generate(request)).rejects.toMatchObject({ code });
    }
    await expect(
      createOpenAiProvider("key", async () =>
        Response.json({ ...envelope(), model: "different" }),
      ).generate(request),
    ).rejects.toMatchObject({ code: "PROVIDER_MODEL_MISMATCH" });
    await expect(
      createOpenAiProvider("key", async () =>
        Response.json({ secret: "never echoed" }),
      ).generate(request),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_ENVELOPE" });
  });
  it("times out and rejects oversized response streams", async () => {
    const fetcher: typeof fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    await expect(
      createOpenAiProvider("key", fetcher).generate({
        ...request,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await expect(
      createOpenAiProvider(
        "key",
        async () => new Response("x".repeat(1000001)),
      ).generate(request),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
  });
});
