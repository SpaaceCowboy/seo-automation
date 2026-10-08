import { z } from "zod";

export interface GenerationRequest {
  model: string;
  system: string;
  input: string;
  maxOutputTokens: number;
  timeoutMs: number;
  temperature?: number | undefined;
  reasoningEffort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max"
    | undefined;
  schema?: Record<string, unknown> | undefined;
}
export interface GenerationResult {
  text: string;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface LLMProvider {
  readonly name: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  structuredGenerate(
    request: GenerationRequest & { schema: Record<string, unknown> },
  ): Promise<GenerationResult>;
}
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = "ProviderError";
  }
}
const responseSchema = z.object({
  model: z.string(),
  service_tier: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
          tool_calls: z.array(z.unknown()).optional(),
        }),
      }),
    )
    .length(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
// Fixed origin and disabled redirects prevent credentials being sent to arbitrary endpoints.
export function createOpenAiProvider(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): LLMProvider {
  if (apiKey.length === 0)
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", false);
  const generate = async (
    request: GenerationRequest,
  ): Promise<GenerationResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetcher(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: request.model,
            store: false,
            service_tier: "default",
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.input },
            ],
            max_completion_tokens: request.maxOutputTokens,
            ...(request.reasoningEffort === undefined
              ? {}
              : { reasoning_effort: request.reasoningEffort }),
            ...(request.temperature === undefined
              ? {}
              : { temperature: request.temperature }),
            ...(request.schema
              ? {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "seo_analysis",
                      strict: true,
                      schema: request.schema,
                    },
                  },
                }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(
          "PROVIDER_HTTP_ERROR",
          response.status === 429 || response.status >= 500,
          response.status,
        );
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw new ProviderError("EMPTY_PROVIDER_RESPONSE", false, 200);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const value: unknown = chunk.value;
          if (!(value instanceof Uint8Array))
            throw new ProviderError("INVALID_PROVIDER_STREAM", false, 200);
          size += value.byteLength;
          if (size > 1000000) {
            await reader.cancel();
            throw new ProviderError("PROVIDER_RESPONSE_TOO_LARGE", false, 200);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      let parsed: z.infer<typeof responseSchema>;
      try {
        parsed = responseSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
      } catch {
        throw new ProviderError("INVALID_PROVIDER_ENVELOPE", true, 200);
      }
      // Pricing is bound to the configured exact model: aliases/auto routing must not silently change it.
      if (parsed.model !== request.model)
        throw new ProviderError("PROVIDER_MODEL_MISMATCH", false, 200);
      if (
        parsed.service_tier !== undefined &&
        parsed.service_tier !== "default"
      )
        throw new ProviderError("PROVIDER_SERVICE_TIER_MISMATCH", false, 200);
      const choice = parsed.choices[0]!;
      if (choice.message.refusal)
        throw new ProviderError("PROVIDER_REFUSAL", false, 200);
      if (choice.message.tool_calls?.length)
        throw new ProviderError("UNEXPECTED_TOOL_CALL", false, 200);
      if (choice.finish_reason !== "stop")
        throw new ProviderError(
          "INCOMPLETE_PROVIDER_OUTPUT",
          choice.finish_reason === "length",
          200,
        );
      if (!choice.message.content)
        throw new ProviderError("EMPTY_PROVIDER_OUTPUT", true, 200);
      const requestId = response.headers.get("x-request-id");
      return {
        text: choice.message.content,
        providerRequestId:
          requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)
            ? requestId
            : null,
        inputTokens: parsed.usage?.prompt_tokens ?? null,
        outputTokens: parsed.usage?.completion_tokens ?? null,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        controller.signal.aborted
          ? "PROVIDER_TIMEOUT"
          : "PROVIDER_NETWORK_ERROR",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  };
  return { name: "openai", generate, structuredGenerate: generate };
}
export function createFakeProvider(
  responder: (
    request: GenerationRequest,
    index: number,
  ) => GenerationResult | Promise<GenerationResult>,
  name = "fixture",
): LLMProvider {
  let index = 0;
  const generate = (request: GenerationRequest) =>
    Promise.resolve(responder(request, index++));
  return { name, generate, structuredGenerate: generate };
}
