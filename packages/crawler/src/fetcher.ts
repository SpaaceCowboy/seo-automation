import { lookup } from "node:dns/promises";

import {
  isInternalUrl,
  isPrivateIpAddress,
  normalizeUrl,
} from "@roco/seo-core";

import type {
  CrawlDependencies,
  CrawlPolicy,
  FetchResult,
  RedirectHopResult,
} from "./types.js";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class CrawlSafetyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CrawlSafetyError";
    this.code = code;
  }
}

async function defaultResolveHost(
  hostname: string,
): Promise<readonly string[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

export async function assertSafeTarget(
  input: string,
  policy: CrawlPolicy,
  resolveHost: (
    hostname: string,
  ) => Promise<readonly string[]> = defaultResolveHost,
): Promise<void> {
  const url = new URL(input);
  if (!isInternalUrl(url.toString(), policy.scope)) {
    throw new CrawlSafetyError(
      "OUT_OF_SCOPE",
      "Target is outside the approved site scope",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new CrawlSafetyError(
      "URL_CREDENTIALS_BLOCKED",
      "URLs containing credentials are not allowed",
    );
  }
  if (policy.allowPrivateNetworks) return;
  const addresses = await resolveHost(url.hostname);
  if (addresses.length === 0 || addresses.some(isPrivateIpAddress)) {
    throw new CrawlSafetyError(
      "PRIVATE_ADDRESS_BLOCKED",
      "Private or unresolved target address is not allowed",
    );
  }
}

async function readLimitedBody(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new CrawlSafetyError(
      "RESPONSE_TOO_LARGE",
      "Response exceeds the configured byte limit",
    );
  }
  if (response.body === null) return "";
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new CrawlSafetyError(
        "RESPONSE_TOO_LARGE",
        "Response exceeds the configured byte limit",
      );
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export interface HttpFetcher {
  fetch(url: string): Promise<FetchResult>;
  setMinimumDelay(milliseconds: number): void;
}

export function createHttpFetcher(
  policy: CrawlPolicy,
  dependencies: CrawlDependencies = {},
): HttpFetcher {
  const fetchFunction = dependencies.fetch ?? fetch;
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  const sleep =
    dependencies.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? Date.now;
  let lastRequestAt: number | null = null;
  let minimumDelayMs = 1_000 / policy.requestsPerSecond;
  let throttleChain = Promise.resolve();

  async function throttle(): Promise<void> {
    const turn = throttleChain.then(async () => {
      const wait =
        lastRequestAt === null
          ? 0
          : Math.max(0, lastRequestAt + minimumDelayMs - now());
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
    });
    throttleChain = turn.catch(() => undefined);
    await turn;
  }

  async function request(url: string): Promise<Response> {
    await assertSafeTarget(url, policy, resolveHost);
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.requestTimeoutMs);
    try {
      return await fetchFunction(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.1",
          "user-agent": policy.userAgent,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    setMinimumDelay(milliseconds) {
      minimumDelayMs = Math.max(minimumDelayMs, milliseconds);
    },
    async fetch(input) {
      const requestedUrl = normalizeUrl(input, undefined, {
        ignoredQueryParameters: policy.ignoredQueryParameters,
      }).normalizedUrl;
      const startedAt = now();
      const redirectHops: RedirectHopResult[] = [];
      const visited = new Set<string>([requestedUrl]);
      let currentUrl = requestedUrl;

      try {
        for (let redirectIndex = 0; ; redirectIndex += 1) {
          let response: Response | undefined;
          let lastError: unknown;
          for (let attempt = 0; attempt <= policy.retryLimit; attempt += 1) {
            try {
              response = await request(currentUrl);
              if (
                !RETRYABLE_STATUSES.has(response.status) ||
                attempt === policy.retryLimit
              )
                break;
              await response.body?.cancel();
              await sleep(Math.min(4_000, 250 * 2 ** attempt));
            } catch (error) {
              lastError = error;
              if (attempt === policy.retryLimit) throw error;
              await sleep(Math.min(4_000, 250 * 2 ** attempt));
            }
          }
          if (response === undefined)
            throw lastError instanceof Error
              ? lastError
              : new Error("Request failed");

          if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (location === null) {
              return {
                requestedUrl,
                finalUrl: currentUrl,
                status: response.status,
                fetchStatus: "HTTP_ERROR",
                headers: Object.fromEntries(response.headers.entries()),
                body: null,
                responseMs: now() - startedAt,
                redirectHops,
                errorCode: "REDIRECT_WITHOUT_LOCATION",
                errorMessage:
                  "Redirect response did not include a Location header",
              };
            }
            const destination = normalizeUrl(location, currentUrl, {
              ignoredQueryParameters: policy.ignoredQueryParameters,
            }).normalizedUrl;
            redirectHops.push({
              hopIndex: redirectIndex,
              sourceUrl: currentUrl,
              destinationUrl: destination,
              httpStatus: response.status,
              responseMs: now() - startedAt,
            });
            if (visited.has(destination)) {
              return {
                requestedUrl,
                finalUrl: destination,
                status: response.status,
                fetchStatus: "REDIRECT_LOOP",
                headers: Object.fromEntries(response.headers.entries()),
                body: null,
                responseMs: now() - startedAt,
                redirectHops,
                errorCode: "REDIRECT_LOOP",
                errorMessage: "Redirect loop detected",
              };
            }
            if (redirectHops.length > policy.maxRedirects) {
              return {
                requestedUrl,
                finalUrl: destination,
                status: response.status,
                fetchStatus: "REDIRECT_LIMIT",
                headers: Object.fromEntries(response.headers.entries()),
                body: null,
                responseMs: now() - startedAt,
                redirectHops,
                errorCode: "REDIRECT_LIMIT",
                errorMessage: "Redirect limit exceeded",
              };
            }
            await assertSafeTarget(destination, policy, resolveHost);
            visited.add(destination);
            currentUrl = destination;
            continue;
          }

          const body = await readLimitedBody(response, policy.maxResponseBytes);
          return {
            requestedUrl,
            finalUrl: currentUrl,
            status: response.status,
            fetchStatus: response.ok ? "SUCCESS" : "HTTP_ERROR",
            headers: Object.fromEntries(response.headers.entries()),
            body,
            responseMs: now() - startedAt,
            redirectHops,
            errorCode: response.ok ? null : `HTTP_${response.status}`,
            errorMessage: response.ok
              ? null
              : `HTTP request returned ${response.status}`,
          };
        }
      } catch (error) {
        const timeout =
          error instanceof DOMException && error.name === "AbortError";
        const safety = error instanceof CrawlSafetyError;
        return {
          requestedUrl,
          finalUrl: null,
          status: null,
          fetchStatus: timeout
            ? "TIMEOUT"
            : safety && error.code === "RESPONSE_TOO_LARGE"
              ? "TOO_LARGE"
              : safety
                ? "BLOCKED"
                : "NETWORK_ERROR",
          headers: {},
          body: null,
          responseMs: now() - startedAt,
          redirectHops,
          errorCode: timeout
            ? "TIMEOUT"
            : safety
              ? error.code
              : "NETWORK_ERROR",
          errorMessage: timeout
            ? "Request timed out"
            : safety
              ? error.message
              : "Network request failed",
        };
      }
    },
  };
}
