import { describe, expect, it, vi } from "vitest";

import {
  assertSafeTarget,
  createHttpFetcher,
  type CrawlPolicy,
} from "../src/index.js";

const policy: CrawlPolicy = {
  startUrl: "https://example.com/",
  scope: {
    canonicalOrigin: "https://example.com",
    allowedHosts: [{ host: "example.com", includeSubdomains: false }],
  },
  userAgent: "RocoSEO/1.0 test",
  maxPages: 10,
  maxDepth: 3,
  concurrency: 2,
  requestsPerSecond: 10,
  requestTimeoutMs: 1_000,
  maxResponseBytes: 100,
  maxRedirects: 3,
  retryLimit: 0,
  respectRobots: true,
  allowPrivateNetworks: false,
  ignoredQueryParameters: [],
};

describe("HTTP fetch safety and redirects", () => {
  it("rejects private addresses, metadata endpoints, unexpected hosts, and out-of-scope redirects", async () => {
    await expect(
      assertSafeTarget("https://example.com/", policy, async () => [
        "169.254.169.254",
      ]),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_BLOCKED" });
    await expect(
      assertSafeTarget("https://outside.test/", policy, async () => [
        "8.8.8.8",
      ]),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });

    const fetcher = createHttpFetcher(policy, {
      resolveHost: async () => ["8.8.8.8"],
      sleep: async () => undefined,
      fetch: vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://outside.test/" },
          }),
      ),
    });
    expect((await fetcher.fetch("https://example.com/")).fetchStatus).toBe(
      "BLOCKED",
    );
  });

  it("records redirect chains and detects loops", async () => {
    const responses = new Map<string, Response>([
      [
        "https://example.com/",
        new Response(null, { status: 301, headers: { location: "/one" } }),
      ],
      [
        "https://example.com/one",
        new Response(null, { status: 302, headers: { location: "/two" } }),
      ],
      [
        "https://example.com/two",
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ],
    ]);
    const fetcher = createHttpFetcher(policy, {
      resolveHost: async () => ["8.8.8.8"],
      sleep: async () => undefined,
      fetch: vi.fn(
        async (input) =>
          responses.get(String(input)) ??
          new Response("missing", { status: 404 }),
      ),
    });
    const result = await fetcher.fetch("https://example.com/");
    expect(result.status).toBe(200);
    expect(result.redirectHops).toHaveLength(2);
    expect(result.finalUrl).toBe("https://example.com/two");

    const loopFetcher = createHttpFetcher(policy, {
      resolveHost: async () => ["8.8.8.8"],
      sleep: async () => undefined,
      fetch: vi.fn(
        async (input) =>
          new Response(null, {
            status: 302,
            headers: {
              location: String(input).endsWith("/loop") ? "/" : "/loop",
            },
          }),
      ),
    });
    expect((await loopFetcher.fetch("https://example.com/")).fetchStatus).toBe(
      "REDIRECT_LOOP",
    );
  });

  it("enforces the response-size budget", async () => {
    const fetcher = createHttpFetcher(
      { ...policy, maxResponseBytes: 5 },
      {
        resolveHost: async () => ["8.8.8.8"],
        sleep: async () => undefined,
        fetch: vi.fn(async () => new Response("too large", { status: 200 })),
      },
    );
    expect((await fetcher.fetch("https://example.com/")).fetchStatus).toBe(
      "TOO_LARGE",
    );
  });

  it("retries retryable responses and enforces request rate", async () => {
    let clock = 0;
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const fetcher = createHttpFetcher(
      { ...policy, retryLimit: 1 },
      {
        resolveHost: async () => ["8.8.8.8"],
        sleep,
        now: () => clock,
        fetch: fetchMock,
      },
    );
    expect((await fetcher.fetch("https://example.com/")).status).toBe(200);
    await fetcher.fetch("https://example.com/second");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("returns a structured timeout failure", async () => {
    const fetcher = createHttpFetcher(
      { ...policy, requestTimeoutMs: 1 },
      {
        resolveHost: async () => ["8.8.8.8"],
        sleep: async () => undefined,
        fetch: vi.fn(
          (
            _input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
          ) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
      },
    );
    expect((await fetcher.fetch("https://example.com/")).fetchStatus).toBe(
      "TIMEOUT",
    );
  });
});
